import { cosine, jaroWinkler } from "../similarity";
import { compact, tokenize } from "../tokenizer";
import type { Extension } from "../types";
import type { Match, Scorer } from "./scorer";

export interface LexicalWeights {
  /** Term weights per manifest field in the TF-IDF vectors. */
  fields: {
    title: number;
    description: number;
    commands: number;
    tools: number;
    keywords: number;
    categories: number;
  };
  /** Score that identical names reach on their own, without any content similarity. */
  name: number;
  /** Jaro-Winkler similarity below which names count as unrelated. */
  nameFloor: number;
}

export const DEFAULT_LEXICAL_WEIGHTS: LexicalWeights = {
  fields: {
    title: 3,
    description: 2,
    commands: 1.5,
    tools: 1,
    keywords: 1.5,
    categories: 0.5,
  },
  name: 0.5,
  nameFloor: 0.8,
};

/**
 * TF-IDF cosine similarity over weighted manifest fields, combined with Jaro-Winkler similarity of names and titles
 * as `1 - (1 - content) * (1 - name)`, so that either signal alone can raise the score.
 */
export class LexicalScorer implements Scorer {
  readonly name = "lexical";

  constructor(private readonly weights: LexicalWeights = DEFAULT_LEXICAL_WEIGHTS) {}

  async score(queries: Extension[], candidates: Extension[]): Promise<Match[][]> {
    const queryTerms = queries.map((extension) => this.termFrequencies(extension));
    const candidateTerms = candidates.map((extension) => this.termFrequencies(extension));
    const idf = inverseDocumentFrequencies([...queryTerms, ...candidateTerms]);
    const candidateVectors = candidateTerms.map((terms) => tfidf(terms, idf));
    const candidateNames = candidates.map(names);

    return queries.map((query, index) => {
      const vector = tfidf(queryTerms[index]!, idf);
      const queryNames = names(query);
      return candidates
        .map((candidate, candidateIndex): Match => {
          const content = cosine(vector, candidateVectors[candidateIndex]!);
          const nameSimilarity = bestNameSimilarity(queryNames, candidateNames[candidateIndex]!);
          const name = Math.max(0, (nameSimilarity - this.weights.nameFloor) / (1 - this.weights.nameFloor));
          return {
            candidate,
            score: round(1 - (1 - content) * (1 - this.weights.name * name)),
            signals: { content: round(content), name: round(nameSimilarity) },
          };
        })
        .sort((a, b) => b.score - a.score);
    });
  }

  private termFrequencies(extension: Extension): Map<string, number> {
    const { fields } = this.weights;
    const terms = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const token of tokenize(text)) {
        terms.set(token, (terms.get(token) ?? 0) + weight);
      }
    };
    add(extension.title, fields.title);
    add(extension.description, fields.description);
    for (const command of extension.commands) {
      add(`${command.title} ${command.description}`, fields.commands);
    }
    for (const tool of extension.tools) {
      add(`${tool.title} ${tool.description}`, fields.tools);
    }
    add(extension.keywords.join(" "), fields.keywords);
    add(extension.categories.join(" "), fields.categories);
    return terms;
  }
}

function inverseDocumentFrequencies(documents: Map<string, number>[]): Map<string, number> {
  const documentFrequencies = new Map<string, number>();
  for (const terms of documents) {
    for (const term of terms.keys()) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequencies) {
    idf.set(term, Math.log((documents.length + 1) / (frequency + 1)) + 1);
  }
  return idf;
}

function tfidf(terms: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [term, frequency] of terms) {
    vector.set(term, Math.log1p(frequency) * (idf.get(term) ?? 1));
  }
  return vector;
}

function names(extension: Extension): string[] {
  return [...new Set([compact(extension.name), compact(extension.title)].filter(Boolean))];
}

function bestNameSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const left of a) {
    for (const right of b) {
      best = Math.max(best, jaroWinkler(left, right));
    }
  }
  return best;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
