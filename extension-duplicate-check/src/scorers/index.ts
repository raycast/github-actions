import { JevScorer } from "./jev";
import { LexicalScorer } from "./lexical";
import type { Scorer } from "./scorer";

export type { Match, Relation, Scorer } from "./scorer";

export interface ScorerOptions {
  typesafeApiKey?: string;
  typesafeModel?: string;
}

const SCORERS: Record<string, (options: ScorerOptions) => Scorer> = {
  lexical: () => new LexicalScorer(),
  jev: ({ typesafeApiKey, typesafeModel }) => {
    if (!typesafeApiKey) {
      throw new Error('The "jev" scorer needs the typesafe-api-key input');
    }
    return new JevScorer({ apiKey: typesafeApiKey, model: typesafeModel });
  },
};

export const SCORER_NAMES = Object.keys(SCORERS);

export function createScorer(name: string, options: ScorerOptions = {}): Scorer {
  const create = SCORERS[name.trim().toLowerCase()];
  if (!create) {
    throw new Error(`Unknown scorer "${name}". Supported scorers: ${SCORER_NAMES.join(", ")}`);
  }
  return create(options);
}
