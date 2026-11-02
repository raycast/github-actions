import type { Extension } from "../types";

/** How an existing extension relates to a new one, as judged by a model. */
export type Relation = "different" | "partial" | "enhancement" | "same";

export interface Match {
  candidate: Extension;
  /** Similarity between 0 and 1. */
  score: number;
  /** Scorer-specific components of the score, reported for transparency. */
  signals: Record<string, number>;
  /** Set by scorers that judge the relation, e.g. `jev`, and used to word the comment. */
  relation?: Relation;
}

/**
 * Scores how similar each new extension is to every candidate extension. Implementations can be lexical (in
 * process) or semantic (e.g. backed by a remote embedding service), hence the async batch signature.
 */
export interface Scorer {
  readonly name: string;
  /** Returns, for each query, its matches against the candidates sorted by descending score. */
  score(queries: Extension[], candidates: Extension[]): Promise<Match[][]>;
}
