import { describe, expect, it } from "vitest";
import { parseRedashResult } from "../src/sources/store";
import { storeFixture } from "./helpers";

describe("parseRedashResult", () => {
  it("reads the query_result.data.rows payload", () => {
    const store = storeFixture();
    expect(store).toHaveLength(10);
    expect(store[0]).toMatchObject({
      source: "store",
      name: "spotify-player",
      title: "Spotify Player",
      author: "mattisssa",
      keywords: ["music", "spotify", "player"],
      categories: ["Media"],
      url: "https://www.raycast.com/mattisssa/spotify-player",
    });
    expect(store[0]!.commands.map((command) => command.name)).toEqual([
      "search",
      "nowPlaying",
      "togglePlayPause",
      "next",
    ]);
  });

  it("accepts aliased and differently cased column names", () => {
    const [extension] = parseRedashResult({
      query_result: {
        data: {
          rows: [
            {
              Extension_Slug: "kill-process",
              DisplayName: "Kill Process",
              summary: "Terminate processes",
              Owner: '{"handle":"rolandleth","name":"Roland"}',
              Store_URL: "https://www.raycast.com/rolandleth/kill-process",
              tags: "{cpu,memory}",
              category: "System",
              commands: "index, kill-all",
            },
          ],
        },
      },
    });
    expect(extension).toMatchObject({
      name: "kill-process",
      title: "Kill Process",
      description: "Terminate processes",
      author: "rolandleth",
      url: "https://www.raycast.com/rolandleth/kill-process",
      keywords: ["cpu", "memory"],
      categories: ["System"],
      commands: [
        { name: "index", title: "index", description: "" },
        { name: "kill-all", title: "kill-all", description: "" },
      ],
    });
  });

  it("merges rows that list one command each", () => {
    const store = parseRedashResult({
      data: {
        rows: [
          { name: "todoist", title: "Todoist", author: "thomaslombart", command_name: "home", command_title: "Home" },
          {
            name: "todoist",
            title: "Todoist",
            author: "thomaslombart",
            command_name: "create-task",
            command_title: "Create Task",
            command_description: "Create a new task",
          },
        ],
      },
    });
    expect(store).toHaveLength(1);
    expect(store[0]!.commands).toEqual([
      { name: "home", title: "Home", description: "" },
      { name: "create-task", title: "Create Task", description: "Create a new task" },
    ]);
  });

  it("falls back to a manifest column", () => {
    const [extension] = parseRedashResult([
      {
        manifest: JSON.stringify({
          name: "brew",
          title: "Brew",
          description: "Homebrew",
          author: "nhojb",
          commands: [{ name: "search", title: "Search" }],
          keywords: ["homebrew"],
        }),
      },
    ]);
    expect(extension).toMatchObject({
      name: "brew",
      title: "Brew",
      description: "Homebrew",
      author: "nhojb",
      keywords: ["homebrew"],
      url: "https://www.raycast.com/nhojb/brew",
    });
    expect(extension!.commands).toHaveLength(1);
  });

  it("skips rows without a name or title and tolerates null values", () => {
    const store = parseRedashResult({ data: { rows: [{ description: "orphan" }, null, { title: "Only Title", keywords: null }] } });
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ name: "Only Title", title: "Only Title", keywords: [] });
  });

  it("explains payloads without rows", () => {
    expect(() => parseRedashResult({ job: { id: "1", status: 1 } })).toThrow("no cached result");
    expect(() => parseRedashResult({ message: "Couldn't find resource" })).toThrow("no rows found");
  });
});
