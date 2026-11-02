import { describe, expect, it } from "vitest";
import { isExtensionManifestPath, parseManifest } from "../src/manifest";
import { manifestFixture } from "./helpers";

describe("isExtensionManifestPath", () => {
  it("only matches top-level extension manifests", () => {
    expect(isExtensionManifestPath("extensions/foo/package.json")).toBe(true);
    expect(isExtensionManifestPath("extensions/foo/package-lock.json")).toBe(false);
    expect(isExtensionManifestPath("extensions/foo/node_modules/bar/package.json")).toBe(false);
    expect(isExtensionManifestPath("package.json")).toBe(false);
  });
});

describe("parseManifest", () => {
  it("reads the fields used for matching", () => {
    expect(manifestFixture("spotify-controls")).toMatchObject({
      source: "pull-request",
      name: "spotify-controls",
      title: "Spotify Controls",
      author: "another",
      categories: ["Media"],
      keywords: [],
      tools: [{ name: "play-song", title: "Play Song", description: "Play a song on Spotify" }],
      path: "extensions/spotify-controls/package.json",
    });
    expect(manifestFixture("spotify-controls").commands).toHaveLength(3);
  });

  it("falls back to the folder name and ignores invalid JSON", () => {
    expect(parseManifest("{}", { source: "pull-request", path: "extensions/foo/package.json" })).toMatchObject({
      name: "foo",
      title: "foo",
    });
    expect(parseManifest("{", { source: "pull-request" })).toBeUndefined();
    expect(parseManifest("[]", { source: "pull-request" })).toBeUndefined();
  });
});
