import type { Octokit, Repository } from "./sources/pull-requests";
import type { Match, Relation } from "./scorers";
import type { Extension } from "./types";

export const COMMENT_MARKER = "<!-- extension-duplicate-check -->";

export interface ExtensionReport {
  extension: Extension;
  store: Match[];
  pullRequests: Match[];
}

export interface CommentOptions {
  threshold: number;
  scorer: string;
  /** Sources that could not be searched, with the reason. */
  unavailable: string[];
  /** GitHub login of the pull request author, greeted at the top of the comment. */
  author?: string;
}

const GUIDELINES_URL = "https://manual.raycast.com/extensions-guidelines#reasons-to-be-rejected";

/** Renders the comment in the voice of the reviewers' own replies to duplicate extensions in raycast/extensions. */
export function renderComment(reports: ExtensionReport[], options: CommentOptions): string {
  const lines = [COMMENT_MARKER];
  if (options.author) {
    lines.push(`Hey @${options.author} 👋`, "");
  }

  if (reports.length === 0) {
    lines.push("This pull request no longer adds a new extension, so there's nothing to check here 🙂");
    return lines.join("\n");
  }

  const flagged = reports.filter((report) => isDuplicate(report, options.threshold));
  if (flagged.length > 0) {
    lines.push("Thanks for your contribution 🔥", "");
    let count = 0;
    let enhancement = false;
    for (const report of flagged) {
      const matches = [...report.store, ...report.pullRequests].filter((match) => match.score >= options.threshold);
      count += matches.length;
      const relation = strongestRelation(matches);
      enhancement ||= relation === "enhancement";
      lines.push(intro(relation, matches.length, escapeText(report.extension.title)), "");
      lines.push(...matches.map((match) => `* ${describe(match.candidate)}`), "");
    }
    const [it, they, doesnt] = count === 1 ? ["it", "it", "doesn't"] : ["one of them", "they", "don't"];
    lines.push(
      enhancement
        ? `Your extension seems to add features on top of ${count === 1 ? "it" : "them"}. These look like natural ` +
            "enhancements rather than a distinct new extension, so could you contribute them there instead? That " +
            `follows our [extension guidelines](${GUIDELINES_URL}) and brings the improvements to existing users.`
        : `If ${it} already covers what yours does, could you contribute your features there instead? That follows ` +
            `our [extension guidelines](${GUIDELINES_URL}) and brings the improvements to existing users.`,
      "",
      `If yours does something ${they} ${doesnt}, add a short note to the PR description explaining the difference, ` +
        "so we can review it faster 😊",
      "",
    );
  } else {
    lines.push(
      "None of the existing extensions look like a close match, so there's nothing to do here 🙌",
      "",
    );
  }

  lines.push("<details>", "<summary>Match details</summary>", "");
  for (const report of reports) {
    if (reports.length > 1) {
      lines.push(`**${escapeText(report.extension.title)}** (\`${report.extension.name}\`)`, "");
    }
    lines.push(...renderTable([...report.store, ...report.pullRequests], options.threshold), "");
  }
  lines.push(
    options.scorer === "jev"
      ? "Scores come from TypeSafe's Jev model, which judged the closest matches of the `lexical` scorer: how likely " +
          "an extension already does the main task of this one, unless the two are built for different apps or " +
          `services. Matches from ${options.threshold} are flagged.`
      : `Scores range from 0 to 1 and come from the \`${options.scorer}\` scorer, which compares titles, ` +
          "descriptions, commands and keywords, and the similarity of names. Matches from " +
          `${options.threshold} are flagged.`,
    "",
    "</details>",
    "",
  );

  for (const reason of options.unavailable) {
    lines.push("> [!NOTE]", `> ${reason}`, "");
  }

  lines.push(
    "<sub>This is an automated check, so it can get it wrong. A reviewer makes the final call. This comment updates " +
      "on every push.</sub>",
  );
  return lines.join("\n");
}

export function isDuplicate(report: ExtensionReport, threshold: number): boolean {
  return [...report.store, ...report.pullRequests].some((match) => match.score >= threshold);
}

const RELATION_LABELS: Record<Relation, string> = {
  same: "Same purpose",
  enhancement: "Same purpose, adds features",
  partial: "Some overlap",
  different: "Different purpose",
};

/** The closest relation a model reported among the matches, or `undefined` for scorers that don't judge it. */
function strongestRelation(matches: Match[]): Relation | undefined {
  const relations = matches.map((match) => match.relation);
  return relations.includes("same") ? "same" : relations.includes("enhancement") ? "enhancement" : undefined;
}

/** Mirrors the reviewers' "We already have an extension in the Store that covers the same core functionality". */
function intro(relation: Relation | undefined, count: number, title: string): string {
  const one = count === 1;
  if (relation === "same") {
    return one
      ? `We found an extension that covers the same core functionality as **${title}**:`
      : `We found some extensions that cover the same core functionality as **${title}**:`;
  }
  if (relation === "enhancement") {
    return one
      ? `We found an extension with the same main purpose as **${title}**:`
      : `We found some extensions with the same main purpose as **${title}**:`;
  }
  return one
    ? `We found an extension that looks similar to **${title}**:`
    : `We found some extensions that look similar to **${title}**:`;
}

/** One list item, e.g. `[Spotify Player](…) by [mattisssa](…) in the Store`. */
function describe(candidate: Extension): string {
  const title = escapeText(candidate.title);
  if (candidate.source === "store") {
    const name = candidate.url ? `[${title}](${candidate.url})` : title;
    return `${name}${candidate.author ? ` by ${authorLink(candidate.author)}` : ""} in the Store`;
  }
  return candidate.pullRequest ? `${title} in #${candidate.pullRequest.number} (open pull request)` : title;
}

function renderTable(matches: Match[], threshold: number): string[] {
  if (matches.length === 0) {
    return ["_No similar extensions found._"];
  }
  const judged = matches.some((match) => match.relation);
  const rows = judged
    ? ["| Extension | Where | Relation | Score |", "| --- | --- | --- | ---: |"]
    : ["| Extension | Where | Score |", "| --- | --- | ---: |"];
  for (const match of [...matches].sort((a, b) => b.score - a.score)) {
    const { candidate } = match;
    const title = escapeText(candidate.title);
    const name = candidate.source === "store" && candidate.url ? `[${title}](${candidate.url})` : title;
    const where =
      candidate.source === "store"
        ? `Store${candidate.author ? `, ${authorLink(candidate.author)}` : ""}`
        : candidate.pullRequest
          ? `#${candidate.pullRequest.number}`
          : "Pull request";
    const relation = judged ? ` ${match.relation ? RELATION_LABELS[match.relation] : ""} |` : "";
    rows.push(`| ${name} | ${where} |${relation} ${match.score.toFixed(2)}${match.score >= threshold ? " ⚠️" : ""} |`);
  }
  return rows;
}

/** Store handles are Raycast accounts, not GitHub ones, so they link to the Store profile without an @mention. */
function authorLink(handle: string): string {
  return `[${escapeText(handle)}](https://www.raycast.com/${encodeURIComponent(handle)})`;
}

/**
 * Escapes text from manifests, which anyone can write: table and markdown syntax, HTML, and `@` so a title can't
 * mention someone.
 */
function escapeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[|<>[\]*_`\\]/g, (character) => `\\${character}`)
    .replace(/@/g, "@\u200b");
}

/**
 * Updates the marker comment in place, or creates it when `create` is set. Returns the comment URL, or `undefined` when
 * there was no comment to update and none was created.
 */
export async function upsertComment(
  octokit: Octokit,
  repository: Repository,
  issueNumber: number,
  body: string,
  { create = true }: { create?: boolean } = {},
): Promise<string | undefined> {
  const existing = await findComment(octokit, repository, issueNumber);
  if (existing) {
    const { data } = await octokit.rest.issues.updateComment({ ...repository, comment_id: existing, body });
    return data.html_url;
  }
  if (!create) {
    return undefined;
  }
  const { data } = await octokit.rest.issues.createComment({ ...repository, issue_number: issueNumber, body });
  return data.html_url;
}

export async function findComment(
  octokit: Octokit,
  repository: Repository,
  issueNumber: number,
): Promise<number | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repository,
    issue_number: issueNumber,
    per_page: 100,
  });
  return comments.find((comment) => comment.body?.includes(COMMENT_MARKER))?.id;
}
