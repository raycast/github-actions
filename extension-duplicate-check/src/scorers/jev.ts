import type { Extension } from "../types";
import { LexicalScorer } from "./lexical";
import type { Match, Relation, Scorer } from "./scorer";

export interface JevOptions {
  apiKey: string;
  /** TypeSafe model name or alias, see https://docs.typesafe.ai/models. */
  model?: string;
  baseUrl?: string;
  /** Number of top lexical matches per new extension that Jev judges. */
  shortlist?: number;
  fetch?: typeof fetch;
}

const RELATIONS: Record<Relation, string> = {
  different: "They have different main purposes. A user could reasonably want both.",
  partial: "They share some features, but their main purposes are different.",
  enhancement:
    "They have the same main purpose. The new extension adds features or platforms that the existing extension lacks.",
  same: "They have the same main purpose and mostly the same features.",
};

const MAX_ENTRIES = 15;
const MAX_TEXT = 300;
const RETRIES = 3;

/**
 * Shortlists candidates with the lexical scorer, then asks TypeSafe's Jev model about each shortlisted extension:
 * whether it already does the new extension's main task, and whether the two are built for different services (a
 * Spark Mail client doesn't duplicate a Proton Mail one). The score is `covers × (1 - different services)`. A third
 * question, how the two relate, only words the comment. Asking "same main purpose?" directly flagged most extensions in
 * a crowded category, so the judgement is split into these narrow questions, as TypeSafe recommends.
 *
 * The lexical scorer alone ranks the duplicate a reviewer names in its top 10 for most rejected pull requests, but with
 * scores too low to flag. Jev's job is to tell those apart from unrelated neighbours.
 */
export class JevScorer implements Scorer {
  readonly name = "jev";
  private readonly lexical = new LexicalScorer();

  constructor(private readonly options: JevOptions) {}

  async score(queries: Extension[], candidates: Extension[]): Promise<Match[][]> {
    const shortlist = this.options.shortlist ?? 10;
    const lexical = await this.lexical.score(queries, candidates);
    return Promise.all(queries.map((query, index) => this.judge(query, (lexical[index] ?? []).slice(0, shortlist))));
  }

  private async judge(query: Extension, shortlist: Match[]): Promise<Match[]> {
    if (shortlist.length === 0) {
      return [];
    }
    const existing: Record<string, unknown> = {};
    const questions: Record<string, unknown> = {};
    shortlist.forEach((match, index) => {
      const id = `e${index}`;
      existing[id] = summarize(match.candidate);
      questions[`${id}_relation`] = {
        type: "choice",
        instructions: `How does the existing extension \`existing.${id}\` relate to \`new_extension\`?`,
        criteria: RELATIONS,
      };
      questions[`${id}_covers`] = {
        type: "noul",
        instructions: `Can the existing extension \`existing.${id}\` already do the main task of \`new_extension\`?`,
      };
      questions[`${id}_services`] = {
        type: "noul",
        instructions:
          `Are \`new_extension\` and \`existing.${id}\` each built for a different specific app, website or service, ` +
          "for example one for Proton Mail and the other for Spark Mail?",
      };
    });
    const response = await this.request({
      model: this.options.model || "jev-1.14.0",
      state: { new_extension: summarize(query), existing },
      questions,
    });

    return shortlist
      .map((match, index): Match => {
        const relation = response.answers[`e${index}_relation`];
        const probabilities = relation?.probabilities ?? {};
        const covers = response.answers[`e${index}_covers`]?.noul ?? 0;
        const services = response.answers[`e${index}_services`]?.noul ?? 0;
        return {
          candidate: match.candidate,
          score: round(covers * (1 - services)),
          relation: relation?.choice,
          signals: {
            ...match.signals,
            lexical: match.score,
            same: round(probabilities.same ?? 0),
            enhancement: round(probabilities.enhancement ?? 0),
            covers: round(covers),
            services: round(services),
          },
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private async request(body: unknown): Promise<JevResponse> {
    const url = `${(this.options.baseUrl || "https://api.typesafe.ai").replace(/\/+$/, "")}/v1/systemone`;
    const send = this.options.fetch ?? fetch;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await send(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        // Network errors and timeouts.
        if (attempt >= RETRIES) {
          throw error;
        }
        await backoff(attempt);
        continue;
      }
      if (response.ok) {
        return (await response.json()) as JevResponse;
      }
      // 429 is a rate limit and 529 means TypeSafe is overloaded; both are worth retrying, as are server errors.
      if (attempt >= RETRIES || (response.status !== 429 && response.status < 500)) {
        throw new Error(`TypeSafe returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      await backoff(attempt);
    }
  }
}

interface JevResponse {
  answers: Record<
    string,
    { choice?: Relation; probabilities?: Partial<Record<Relation, number>>; noul?: number } | undefined
  >;
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
}

/** Only the fields that say what an extension does, trimmed so one long manifest can't crowd out the rest. */
function summarize(extension: Extension) {
  const entries = (items: Extension["commands"]) =>
    items.slice(0, MAX_ENTRIES).map((item) => clip(item.description ? `${item.title}: ${item.description}` : item.title));
  return {
    title: clip(extension.title),
    description: clip(extension.description),
    commands: entries(extension.commands),
    tools: entries(extension.tools),
    keywords: extension.keywords.slice(0, MAX_ENTRIES).map(clip),
  };
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
