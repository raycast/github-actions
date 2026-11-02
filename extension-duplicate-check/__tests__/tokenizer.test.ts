import { describe, expect, it } from "vitest";
import { compact, normalize, stem, tokenize } from "../src/tokenizer";

describe("normalize", () => {
  it("lowercases, strips diacritics and splits camelCase", () => {
    expect(normalize("Café GitHubPRs")).toBe("cafe git hub p rs");
    expect(normalize("nowPlaying")).toBe("now playing");
    expect(normalize("HTMLParser")).toBe("html parser");
  });
});

describe("tokenize", () => {
  it("splits on punctuation and whitespace", () => {
    expect(tokenize("spotify-player: Play/Pause_track")).toEqual(["spotify", "player", "play", "pause", "track"]);
  });

  it("drops stop words, Raycast boilerplate and single characters", () => {
    expect(tokenize("A Raycast extension to quickly search your Notion pages")).toEqual(["search", "notion", "page"]);
  });

  it("produces the same tokens for differently formatted names", () => {
    expect(tokenize("kill-process")).toEqual(tokenize("Kill Process"));
    expect(tokenize("killProcess")).toEqual(tokenize("kill_process"));
  });

  it("keeps digits and non-Latin letters", () => {
    expect(tokenize("Base64 encode 中文 翻译")).toEqual(["base64", "encode", "中文", "翻译"]);
  });

  it("returns no tokens for empty or boilerplate-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("Raycast extension")).toEqual([]);
  });
});

describe("stem", () => {
  it("reduces common plurals", () => {
    expect(stem("notes")).toBe("note");
    expect(stem("queries")).toBe("query");
    expect(stem("boxes")).toBe("box");
    expect(stem("searches")).toBe("search");
  });

  it("keeps words that only look plural", () => {
    expect(stem("status")).toBe("status");
    expect(stem("process")).toBe("process");
    expect(stem("analysis")).toBe("analysis");
    expect(stem("ios")).toBe("ios");
  });
});

describe("compact", () => {
  it("collapses names and titles to comparable strings", () => {
    expect(compact("Spotify Player")).toBe("spotifyplayer");
    expect(compact("spotify-player")).toBe("spotifyplayer");
  });
});
