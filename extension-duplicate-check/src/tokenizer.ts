const STOP_WORDS = new Set([
  // English
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can",
  "do", "does", "each", "easily", "easy", "every", "for", "from", "get", "has", "have", "how", "i", "if", "in",
  "into", "is", "it", "its", "just", "let", "lets", "like", "make", "me", "more", "most", "my", "new", "no", "not",
  "of", "on", "one", "or", "other", "our", "out", "over", "quick", "quickly", "right", "so", "some", "such", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "those", "through", "to", "up", "use",
  "used", "using", "via", "want", "was", "way", "we", "what", "when", "where", "which", "while", "who", "will",
  "with", "within", "without", "you", "your", "yours",
  // Words that appear in almost every Raycast manifest
  "raycast", "extension", "extensions", "command", "commands",
]);

/**
 * Lowercases, strips diacritics and splits camelCase so that `GitHubPRs`, `github-prs` and `GitHub PRs` normalize
 * to the same words.
 */
export function normalize(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Splits text into normalized, stemmed tokens without stop words. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of normalize(text).split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 || STOP_WORDS.has(word)) {
      continue;
    }
    const token = stem(word);
    if (!STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** Light plural stemming, enough to match `notes` with `note` and `queries` with `query`. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** Collapses a name or title to lowercase letters and digits, e.g. `Todoist Tasks` and `todoist-tasks` → `todoisttasks`. */
export function compact(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}]+/gu, "");
}
