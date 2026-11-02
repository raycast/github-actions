import type { getOctokit } from "@actions/github";
import { isExtensionManifestPath, parseManifest } from "../manifest";
import type { Extension } from "../types";

export type Octokit = ReturnType<typeof getOctokit>;

export interface Repository {
  owner: string;
  repo: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  author?: string;
  headSha: string;
}

const REST_CONCURRENCY = 5;
const MANIFEST_BATCH_SIZE = 50;

/** A manifest added by a pull request, to be read at the pull request's head commit. */
interface AddedManifest {
  pullRequest: PullRequestInfo;
  path: string;
}

/** Returns the extensions whose `extensions/<name>/package.json` is added by the pull request. */
export async function fetchAddedExtensions(
  octokit: Octokit,
  repository: Repository,
  pullRequest: PullRequestInfo,
): Promise<Extension[]> {
  const paths = await listAddedManifestPaths(octokit, repository, pullRequest.number);
  return readManifests(
    octokit,
    repository,
    paths.map((path) => ({ pullRequest, path })),
  );
}

const OPEN_PULL_REQUESTS_QUERY = `
  query ($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: OPEN, first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          url
          headRefOid
          author { login }
          files(first: 100) {
            pageInfo { hasNextPage }
            nodes { path changeType }
          }
        }
      }
    }
  }
`;

interface OpenPullRequestsResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        number: number;
        title: string;
        url: string;
        headRefOid: string;
        author: { login: string } | null;
        files: {
          pageInfo: { hasNextPage: boolean };
          nodes: Array<{ path: string; changeType: string }> | null;
        } | null;
      } | null>;
    };
  };
}

/** Returns the extensions added by every other open pull request. */
export async function fetchOpenPullRequestExtensions(
  octokit: Octokit,
  repository: Repository,
  excludeNumber: number,
): Promise<Extension[]> {
  const manifests: AddedManifest[] = [];
  const truncated: PullRequestInfo[] = [];
  let cursor: string | null = null;
  do {
    const response: OpenPullRequestsResponse = await octokit.graphql(OPEN_PULL_REQUESTS_QUERY, {
      owner: repository.owner,
      repo: repository.repo,
      cursor,
    });
    const { nodes, pageInfo } = response.repository.pullRequests;
    for (const node of nodes) {
      if (!node || node.number === excludeNumber) {
        continue;
      }
      const pullRequest: PullRequestInfo = {
        number: node.number,
        title: node.title,
        url: node.url,
        author: node.author?.login,
        headSha: node.headRefOid,
      };
      const paths = (node.files?.nodes ?? [])
        .filter((file) => file.changeType === "ADDED" && isExtensionManifestPath(file.path))
        .map((file) => file.path);
      if (paths.length === 0 && (!node.files || node.files.pageInfo.hasNextPage)) {
        truncated.push(pullRequest);
      }
      manifests.push(...paths.map((path) => ({ pullRequest, path })));
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  // GraphQL only returns the first 100 files, so list the files of larger pull requests through REST.
  for (let start = 0; start < truncated.length; start += REST_CONCURRENCY) {
    const batch = truncated.slice(start, start + REST_CONCURRENCY);
    const paths = await Promise.all(
      batch.map((pullRequest) => listAddedManifestPaths(octokit, repository, pullRequest.number)),
    );
    batch.forEach((pullRequest, index) => {
      manifests.push(...paths[index]!.map((path) => ({ pullRequest, path })));
    });
  }

  return readManifests(octokit, repository, manifests);
}

async function listAddedManifestPaths(octokit: Octokit, repository: Repository, number: number): Promise<string[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...repository,
    pull_number: number,
    per_page: 100,
  });
  return files.filter((file) => file.status === "added" && isExtensionManifestPath(file.filename)).map((file) => file.filename);
}

/**
 * Reads manifests at each pull request's head commit, batched into GraphQL queries. Fork commits are reachable
 * from the base repository through the pull request refs, so the base repository is queried for all of them.
 */
async function readManifests(octokit: Octokit, repository: Repository, manifests: AddedManifest[]): Promise<Extension[]> {
  const extensions: Extension[] = [];
  for (let start = 0; start < manifests.length; start += MANIFEST_BATCH_SIZE) {
    const batch = manifests.slice(start, start + MANIFEST_BATCH_SIZE);
    const fields = batch
      .map(
        ({ pullRequest, path }, index) =>
          `m${index}: object(expression: ${JSON.stringify(`${pullRequest.headSha}:${path}`)}) { ... on Blob { text } }`,
      )
      .join("\n");
    const response: { repository: Record<string, { text?: string | null } | null> } = await octokit.graphql(
      `query ($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`,
      { owner: repository.owner, repo: repository.repo },
    );
    batch.forEach(({ pullRequest, path }, index) => {
      const text = response.repository[`m${index}`]?.text;
      const extension = text
        ? parseManifest(text, {
            source: "pull-request",
            path,
            url: pullRequest.url,
            pullRequest: { number: pullRequest.number, title: pullRequest.title, author: pullRequest.author },
          })
        : undefined;
      if (extension) {
        extensions.push(extension);
      }
    });
  }
  return extensions;
}
