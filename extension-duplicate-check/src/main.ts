import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { isDuplicate, renderComment, upsertComment, type ExtensionReport } from "./comment";
import { createScorer } from "./scorers";
import {
  fetchAddedExtensions,
  fetchOpenPullRequestExtensions,
  type Octokit,
  type PullRequestInfo,
  type Repository,
} from "./sources/pull-requests";
import { fetchStoreExtensions } from "./sources/store";
import type { Extension } from "./types";

interface Inputs {
  githubToken: string;
  redashApiKey: string;
  redashUrl: string;
  redashQueryId: string;
  scorer: string;
  typesafeApiKey: string;
  typesafeModel: string;
  threshold: number;
  minScore: number;
  topN: number;
  label: string;
  checkOpenPullRequests: boolean;
  comment: boolean;
  pullRequestNumber?: number;
}

export async function run(): Promise<void> {
  try {
    await check(readInputs());
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

function readInputs(): Inputs {
  const redashApiKey = core.getInput("redash-api-key");
  const typesafeApiKey = core.getInput("typesafe-api-key");
  for (const secret of [redashApiKey, typesafeApiKey]) {
    if (secret) {
      core.setSecret(secret);
    }
  }
  const pullRequestNumber = core.getInput("pull-request-number");
  return {
    githubToken: core.getInput("github-token", { required: true }),
    redashApiKey,
    redashUrl: core.getInput("redash-url") || "https://redash.raycast.com",
    redashQueryId: core.getInput("redash-query-id") || "3594",
    scorer: core.getInput("scorer") || "lexical",
    typesafeApiKey,
    typesafeModel: core.getInput("typesafe-model") || "jev-1.14.0",
    threshold: numberInput("threshold", 0.5),
    minScore: numberInput("min-score", 0.2),
    topN: Math.max(1, Math.floor(numberInput("top-n", 5))),
    label: core.getInput("label"),
    checkOpenPullRequests: booleanInput("check-open-pull-requests", true),
    comment: booleanInput("comment", true),
    pullRequestNumber: pullRequestNumber ? Number.parseInt(pullRequestNumber, 10) : undefined,
  };
}

function numberInput(name: string, fallback: number): number {
  const value = core.getInput(name);
  if (!value) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Input "${name}" must be a number, got "${value}"`);
  }
  return number;
}

function booleanInput(name: string, fallback: boolean): boolean {
  return core.getInput(name) ? core.getBooleanInput(name) : fallback;
}

async function check(inputs: Inputs): Promise<void> {
  let scorer = createScorer(inputs.scorer, inputs);
  const octokit = getOctokit(inputs.githubToken);
  const repository: Repository = context.repo;
  const pullRequest = await resolvePullRequest(octokit, repository, inputs.pullRequestNumber);

  const added = await fetchAddedExtensions(octokit, repository, pullRequest);
  if (added.length === 0) {
    core.info(`#${pullRequest.number} does not add a new extension.`);
    setOutputs([], false);
    if (inputs.comment) {
      // Only touch an earlier comment, e.g. if the new extension was renamed into an existing folder.
      const body = renderComment([], commentOptions(inputs, [], pullRequest.author));
      await upsertComment(octokit, repository, pullRequest.number, body, { create: false });
    }
    await syncLabel(octokit, repository, pullRequest.number, inputs.label, false);
    return;
  }
  core.info(`#${pullRequest.number} adds: ${added.map((extension) => extension.path).join(", ")}`);

  const unavailable: string[] = [];
  const [store, openPullRequests] = await Promise.all([
    loadStore(inputs, unavailable),
    loadOpenPullRequests(octokit, repository, pullRequest.number, inputs, unavailable),
  ]);
  core.info(`Comparing against ${store.length} store extensions and ${openPullRequests.length} open pull requests.`);

  const candidates = [...store, ...openPullRequests];
  let results;
  try {
    results = await scorer.score(added, candidates);
  } catch (error) {
    if (scorer.name === "lexical") {
      throw error;
    }
    // A model outage shouldn't block the check: fall back to the in-process scorer and warn in the run.
    core.warning(`The ${scorer.name} scorer failed, falling back to lexical: ${errorMessage(error)}`);
    scorer = createScorer("lexical");
    results = await scorer.score(added, candidates);
  }
  const reports: ExtensionReport[] = added.map((extension, index) => {
    const matches = (results[index] ?? []).filter((match) => match.score >= inputs.minScore);
    return {
      extension,
      store: matches.filter((match) => match.candidate.source === "store").slice(0, inputs.topN),
      pullRequests: matches.filter((match) => match.candidate.source === "pull-request").slice(0, inputs.topN),
    };
  });

  const hasDuplicates = reports.some((report) => isDuplicate(report, inputs.threshold));
  setOutputs(reports, hasDuplicates);

  const body = renderComment(reports, commentOptions(inputs, unavailable, pullRequest.author));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary.addRaw(body).write();
  }
  if (inputs.comment) {
    // Only open a comment for a possible duplicate. An earlier one is still updated, so it doesn't go stale.
    const url = await upsertComment(octokit, repository, pullRequest.number, body, { create: hasDuplicates });
    core.info(url ? `Updated ${url}` : "No possible duplicates, so no comment was created.");
  }
  await syncLabel(octokit, repository, pullRequest.number, inputs.label, hasDuplicates);
}

async function resolvePullRequest(
  octokit: Octokit,
  repository: Repository,
  number: number | undefined,
): Promise<PullRequestInfo> {
  const payload = context.payload.pull_request;
  if (payload && (number === undefined || number === payload.number)) {
    return {
      number: payload.number,
      title: payload.title,
      url: payload.html_url ?? "",
      author: payload.user?.login,
      headSha: payload.head.sha,
    };
  }
  if (number === undefined || Number.isNaN(number)) {
    throw new Error("Run this action on pull_request(_target) events or set the pull-request-number input");
  }
  const { data } = await octokit.rest.pulls.get({ ...repository, pull_number: number });
  return { number, title: data.title, url: data.html_url, author: data.user?.login, headSha: data.head.sha };
}

async function loadStore(inputs: Inputs, unavailable: string[]): Promise<Extension[]> {
  if (!inputs.redashApiKey) {
    core.warning("redash-api-key is not set, skipping the store catalog.");
    unavailable.push("Store extensions could not be checked this time.");
    return [];
  }
  try {
    return await fetchStoreExtensions({
      baseUrl: inputs.redashUrl,
      queryId: inputs.redashQueryId,
      apiKey: inputs.redashApiKey,
    });
  } catch (error) {
    core.warning(`Could not load the store catalog: ${errorMessage(error)}`);
    unavailable.push("Store extensions could not be checked this time.");
    return [];
  }
}

async function loadOpenPullRequests(
  octokit: Octokit,
  repository: Repository,
  current: number,
  inputs: Inputs,
  unavailable: string[],
): Promise<Extension[]> {
  if (!inputs.checkOpenPullRequests) {
    return [];
  }
  try {
    return await fetchOpenPullRequestExtensions(octokit, repository, current);
  } catch (error) {
    core.warning(`Could not load open pull requests: ${errorMessage(error)}`);
    unavailable.push("Open pull requests could not be checked this time.");
    return [];
  }
}

function commentOptions(inputs: Inputs, unavailable: string[], author?: string) {
  return { threshold: inputs.threshold, unavailable, author };
}

function setOutputs(reports: ExtensionReport[], hasDuplicates: boolean) {
  core.setOutput("has-duplicates", hasDuplicates ? "true" : "false");
  core.setOutput(
    "matches",
    JSON.stringify(
      reports.map((report) => ({
        name: report.extension.name,
        title: report.extension.title,
        path: report.extension.path,
        store: report.store.map(toOutput),
        pullRequests: report.pullRequests.map(toOutput),
      })),
    ),
  );
}

function toOutput({ candidate, score, signals }: ExtensionReport["store"][number]) {
  return {
    name: candidate.name,
    title: candidate.title,
    author: candidate.author,
    url: candidate.url,
    pullRequest: candidate.pullRequest?.number,
    score,
    signals,
  };
}

async function syncLabel(
  octokit: Octokit,
  repository: Repository,
  issueNumber: number,
  label: string,
  apply: boolean,
): Promise<void> {
  if (!label) {
    return;
  }
  if (apply) {
    await octokit.rest.issues.addLabels({ ...repository, issue_number: issueNumber, labels: [label] });
    return;
  }
  try {
    await octokit.rest.issues.removeLabel({ ...repository, issue_number: issueNumber, name: label });
  } catch (error) {
    // 404 means the label was not applied.
    if ((error as { status?: number }).status !== 404) {
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
