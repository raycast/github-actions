import { describe, expect, it } from "vitest";
import { JevScorer } from "../src/scorers/jev";
import { manifestFixture, storeFixture } from "./helpers";

type Body = { model: string; state: { existing: Record<string, { title: string }> }; questions: Record<string, unknown> };

/** Answers as if the extensions titled in `related` cover the new one, and nothing else does. */
function fakeTypeSafe(related: Record<string, "same" | "enhancement">, statuses: number[] = []) {
  const requests: Body[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    requests.push(body);
    const status = statuses.shift();
    if (status) {
      return new Response("busy", { status });
    }
    const answers = Object.fromEntries(
      Object.entries(body.state.existing).flatMap(([id, extension]) => {
        const relation = related[extension.title] ?? "different";
        return [
          [`${id}_relation`, { type: "choice", choice: relation, probabilities: { [relation]: 0.9, partial: 0.1 } }],
          [`${id}_covers`, { type: "noul", noul: relation === "different" ? 0.1 : 0.9 }],
          [`${id}_services`, { type: "noul", noul: 0.1 }],
        ];
      }),
    );
    return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 1, output_tokens: 1 } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe("JevScorer", () => {
  it("judges the lexical shortlist and scores by whether a match covers the new extension", async () => {
    const { fetch, requests } = fakeTypeSafe({ "Spotify Player": "enhancement" });
    const scorer = new JevScorer({ apiKey: "key", shortlist: 3, fetch });
    const [matches] = await scorer.score([manifestFixture("spotify-controls")], storeFixture());

    expect(requests).toHaveLength(1);
    expect(requests[0]!.model).toBe("jev-1.14.0");
    expect(Object.keys(requests[0]!.questions)).toHaveLength(9);
    expect(requests[0]!.questions).toHaveProperty("e0_covers");
    expect(matches).toHaveLength(3);
    // covers × (1 - different services)
    expect(matches![0]).toMatchObject({ score: 0.81, relation: "enhancement" });
    expect(matches![0]!.candidate.title).toBe("Spotify Player");
    expect(matches![0]!.signals).toMatchObject({ covers: 0.9, services: 0.1, enhancement: 0.9 });
    expect(matches![0]!.signals.lexical).toBeGreaterThan(0);
    expect(matches![1]!.score).toBe(0.09);
  });

  it("retries when TypeSafe is overloaded and fails on other errors", async () => {
    const busy = fakeTypeSafe({}, [529]);
    await new JevScorer({ apiKey: "key", shortlist: 1, fetch: busy.fetch }).score(
      [manifestFixture("spotify-controls")],
      storeFixture(),
    );
    expect(busy.requests).toHaveLength(2);

    const unauthorized = fakeTypeSafe({}, [401]);
    await expect(
      new JevScorer({ apiKey: "bad", fetch: unauthorized.fetch }).score([manifestFixture("spotify-controls")], storeFixture()),
    ).rejects.toThrow("HTTP 401");
  });

  it("skips the request when there is nothing to compare", async () => {
    const { fetch, requests } = fakeTypeSafe({});
    expect(await new JevScorer({ apiKey: "key", fetch }).score([manifestFixture("spotify-controls")], [])).toEqual([[]]);
    expect(requests).toHaveLength(0);
  });
});
