import { describe, expect, it } from "vitest";
import { createScorer } from "../src/scorers";
import { LexicalScorer } from "../src/scorers/lexical";
import type { Extension } from "../src/types";
import { manifestFixture, storeFixture } from "./helpers";

const store = storeFixture();
const scorer = new LexicalScorer();

async function topMatch(extension: Extension, candidates: Extension[] = store) {
  const [matches] = await scorer.score([extension], candidates);
  return matches!;
}

describe("LexicalScorer", () => {
  it("ranks the store extension a new extension duplicates first", async () => {
    const pomodoro = await topMatch(manifestFixture("pomodoro-focus"));
    expect(pomodoro[0]!.candidate.name).toBe("pomodoro");
    expect(pomodoro[0]!.score).toBeGreaterThanOrEqual(0.6);

    const spotify = await topMatch(manifestFixture("spotify-controls"));
    expect(spotify[0]!.candidate.name).toBe("spotify-player");
    expect(spotify[0]!.score).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps unrelated extensions below the default threshold", async () => {
    const matches = await topMatch(manifestFixture("svg-optimizer"));
    expect(matches[0]!.score).toBeLessThan(0.4);
  });

  it("ranks the second-closest extension below the duplicate", async () => {
    const matches = await topMatch(manifestFixture("pomodoro-focus"));
    expect(matches[1]!.candidate.name).toBe("timers");
    expect(matches[1]!.score).toBeLessThan(matches[0]!.score);
  });

  it("scores an identical extension in another pull request close to 1", async () => {
    const extension = manifestFixture("spotify-controls");
    const copy = { ...manifestFixture("spotify-controls"), pullRequest: { number: 2, title: "Add Spotify Controls" } };
    const matches = await topMatch(extension, [...store, copy]);
    expect(matches[0]!.candidate).toBe(copy);
    expect(matches[0]!.score).toBeCloseTo(1, 2);
  });

  it("uses fuzzy names when descriptions differ", async () => {
    const extension = manifestFixture("svg-optimizer");
    const renamed: Extension = {
      ...extension,
      name: "svg-optimiser",
      title: "SVG Optimiser",
      description: "Shrink vector graphics.",
      commands: [],
      keywords: [],
    };
    const [match] = await topMatch(extension, [...store, renamed]);
    expect(match!.candidate).toBe(renamed);
    expect(match!.signals.name).toBeGreaterThan(0.9);
    expect(match!.signals.content).toBeLessThan(match!.signals.name!);
  });

  it("returns every candidate sorted by descending score with bounded values", async () => {
    const results = await scorer.score([manifestFixture("pomodoro-focus"), manifestFixture("svg-optimizer")], store);
    expect(results).toHaveLength(2);
    for (const matches of results) {
      expect(matches).toHaveLength(store.length);
      const scores = matches.map((match) => match.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("handles empty candidates and manifests without text", async () => {
    const empty: Extension = {
      source: "pull-request",
      name: "x",
      title: "",
      description: "",
      commands: [],
      tools: [],
      keywords: [],
      categories: [],
    };
    expect(await scorer.score([empty], [])).toEqual([[]]);
    const [matches] = await scorer.score([empty], store);
    expect(matches!.every((match) => Number.isFinite(match.score))).toBe(true);
  });
});

describe("createScorer", () => {
  it("defaults to the lexical scorer and rejects unknown names", () => {
    expect(createScorer("lexical").name).toBe("lexical");
    expect(createScorer(" Lexical ").name).toBe("lexical");
    expect(() => createScorer("embedding")).toThrow('Unknown scorer "embedding". Supported scorers: lexical, jev');
  });

  it("creates the jev scorer only with an API key", () => {
    expect(createScorer("jev", { typesafeApiKey: "key" }).name).toBe("jev");
    expect(() => createScorer("jev")).toThrow("typesafe-api-key");
  });
});
