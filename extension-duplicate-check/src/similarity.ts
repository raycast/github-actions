/** Jaro-Winkler similarity between 0 (nothing in common) and 1 (identical). */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  if (a === b) {
    return a.length === 0 ? 0 : 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) {
    return 0;
  }

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) {
      continue;
    }
    while (!bMatched[k]) {
      k++;
    }
    if (a[i] !== b[k]) {
      transpositions++;
    }
    k++;
  }

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) {
    prefix++;
  }
  return jaro + prefix * prefixScale * (1 - jaro);
}

/** Cosine similarity of two sparse vectors. */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) {
      dot += weight * other;
    }
  }
  if (dot === 0) {
    return 0;
  }
  return dot / (norm(a) * norm(b));
}

function norm(vector: Map<string, number>): number {
  let sum = 0;
  for (const weight of vector.values()) {
    sum += weight * weight;
  }
  return Math.sqrt(sum);
}
