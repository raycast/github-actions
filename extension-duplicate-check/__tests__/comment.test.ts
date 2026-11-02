import { describe, expect, it } from "vitest";
import { COMMENT_MARKER, renderMatchLog, isDuplicate, renderComment, upsertComment, type ExtensionReport } from "../src/comment";
import { LexicalScorer } from "../src/scorers/lexical";
import { manifestFixture, storeFixture } from "./helpers";

async function report(name: string): Promise<ExtensionReport> {
  const extension = manifestFixture(name);
  const other = {
    ...manifestFixture("pomodoro-focus"),
    url: "https://github.com/raycast/extensions/pull/42",
    pullRequest: { number: 42, title: "Add | Pomodoro" },
  };
  const [matches] = await new LexicalScorer().score([extension], [...storeFixture(), other]);
  const relevant = matches!.filter((match) => match.score >= 0.2);
  return {
    extension,
    store: relevant.filter((match) => match.candidate.source === "store").slice(0, 3),
    pullRequests: relevant.filter((match) => match.candidate.source === "pull-request").slice(0, 3),
  };
}

const options = { threshold: 0.6, unavailable: [] };

describe("renderComment", () => {
  it("greets the author and lists flagged matches in the reviewers' voice", async () => {
    const body = renderComment([await report("spotify-controls")], { ...options, author: "octocat" });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("Hey @octocat 👋\n\nThanks for your contribution 🔥");
    expect(body).toContain("We found an extension that looks similar to **Spotify Controls**:");
    expect(body).toContain("If it already covers what yours does");
    expect(body).toContain(
      "* [Spotify Player](https://www.raycast.com/mattisssa/spotify-player) by " +
        "[mattisssa](https://www.raycast.com/mattisssa) in the Store",
    );
    expect(body).toContain("[extension guidelines](https://manual.raycast.com/extensions-guidelines#reasons-to-be-rejected)");
    expect(body).toContain("<summary>Match details</summary>");
    expect(body).toContain("⚠️");
  });

  it("links open pull requests by number without their titles", async () => {
    const body = renderComment([await report("pomodoro-focus")], { ...options, threshold: 0.2 });
    expect(body).toContain("in #42 (open pull request)");
    expect(body).toContain("| #42 |");
    expect(body).not.toContain("Add \\| Pomodoro");
  });

  it("escapes manifest text so it can't mention people or break the markdown", async () => {
    const spotify = await report("spotify-controls");
    spotify.extension = { ...spotify.extension, title: "Hi @raycast <b>|*" };
    const body = renderComment([spotify], options);
    expect(body).toContain("**Hi @\u200braycast \\<b\\>\\|\\***");
    expect(body).not.toContain("@raycast");
  });

  it("words the comment from the relation a model judged", async () => {
    const spotify = await report("spotify-controls");
    spotify.store = spotify.store.map((match, index) => ({ ...match, relation: index === 0 ? "enhancement" : "different" }));
    const body = renderComment([spotify], options);
    expect(body).toContain("We found an extension with the same main purpose as **Spotify Controls**:");
    expect(body).toContain("Your extension seems to add features on top of it. These look like natural enhancements");
    expect(body).toContain("| Extension | Where | Relation | Score |");
    expect(body).toContain("Same purpose, adds features");

    spotify.store[0] = { ...spotify.store[0]!, relation: "same" };
    expect(renderComment([spotify], options)).toContain(
      "We found an extension that covers the same core functionality as **Spotify Controls**:",
    );
  });

  it("doesn't name the backends behind the check", async () => {
    const body = renderComment([await report("spotify-controls")], options);
    expect(body).toContain("Scores range from 0 to 1");
    expect(body).not.toMatch(/jev|lexical|typesafe|redash|scorer|model/i);
  });

  it("reports unavailable sources, no matches, and no new extension", async () => {
    const body = renderComment([await report("svg-optimizer")], { ...options, unavailable: ["Store not checked."] });
    expect(body).toContain("nothing to do here");
    expect(body).not.toContain("Thanks for your contribution");
    expect(body).toContain("> Store not checked.");
    expect(renderComment([], options)).toContain("no longer adds a new extension");
  });
});

describe("renderMatchLog", () => {
  it("logs signals as one JSON line that can't start a workflow command", async () => {
    const { extension, store } = await report("spotify-controls");
    const match = { ...store[0]!, candidate: { ...store[0]!.candidate, name: "::error::\nhi" }, relation: "same" as const };
    const line = renderMatchLog(extension, match, "jev");
    expect(line.startsWith("Match: {")).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("Match: ".length))).toMatchObject({
      extension: extension.name,
      scorer: "jev",
      relation: "same",
      signals: match.signals,
    });
  });
});

describe("isDuplicate", () => {
  it("compares the best score with the threshold", async () => {
    const spotify = await report("spotify-controls");
    expect(isDuplicate(spotify, 0.6)).toBe(true);
    expect(isDuplicate(spotify, 0.99)).toBe(false);
  });
});

describe("upsertComment", () => {
  function fakeOctokit(comments: Array<{ id: number; body: string }>) {
    const calls: string[] = [];
    const octokit = {
      paginate: async () => comments,
      rest: {
        issues: {
          listComments: () => undefined,
          createComment: async () => {
            calls.push("create");
            return { data: { html_url: "created" } };
          },
          updateComment: async ({ comment_id }: { comment_id: number }) => {
            calls.push(`update ${comment_id}`);
            return { data: { html_url: "updated" } };
          },
        },
      },
    };
    return { octokit: octokit as unknown as Parameters<typeof upsertComment>[0], calls };
  }

  const repository = { owner: "raycast", repo: "extensions" };

  it("updates the comment that carries the marker", async () => {
    const { octokit, calls } = fakeOctokit([
      { id: 1, body: "LGTM" },
      { id: 2, body: `${COMMENT_MARKER}\nold` },
    ]);
    expect(await upsertComment(octokit, repository, 7, "body")).toBe("updated");
    expect(calls).toEqual(["update 2"]);
  });

  it("creates a comment when none carries the marker", async () => {
    const { octokit, calls } = fakeOctokit([{ id: 1, body: "LGTM" }]);
    expect(await upsertComment(octokit, repository, 7, "body")).toBe("created");
    expect(calls).toEqual(["create"]);
  });

  it("does not create a comment when create is off", async () => {
    const { octokit, calls } = fakeOctokit([{ id: 1, body: "LGTM" }]);
    expect(await upsertComment(octokit, repository, 7, "body", { create: false })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("still updates an earlier comment when create is off", async () => {
    const { octokit, calls } = fakeOctokit([{ id: 2, body: `${COMMENT_MARKER}\nold` }]);
    expect(await upsertComment(octokit, repository, 7, "body", { create: false })).toBe("updated");
    expect(calls).toEqual(["update 2"]);
  });
});
