import type { Extension, ExtensionEntry, ExtensionSource } from "./types";

/** Matches the manifest of a top-level extension folder, e.g. `extensions/foo/package.json`. */
const MANIFEST_PATH = /^extensions\/[^/]+\/package\.json$/;

export function isExtensionManifestPath(path: string): boolean {
  return MANIFEST_PATH.test(path);
}

export function parseManifest(
  text: string,
  meta: Partial<Extension> & { source: ExtensionSource },
): Extension | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) {
    return undefined;
  }
  return manifestToExtension(json, meta);
}

export function manifestToExtension(
  manifest: Record<string, unknown>,
  meta: Partial<Extension> & { source: ExtensionSource },
): Extension | undefined {
  const name = asString(manifest.name) || folderName(meta.path);
  const title = asString(manifest.title) || name;
  if (!name && !title) {
    return undefined;
  }
  return {
    name,
    title,
    description: asString(manifest.description),
    author: asString(manifest.author) || undefined,
    commands: asEntries(manifest.commands),
    tools: asEntries(manifest.tools),
    keywords: asStrings(manifest.keywords),
    categories: asStrings(manifest.categories),
    ...meta,
  };
}

function folderName(path: string | undefined): string {
  return path?.split("/")[1] ?? "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

export function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter(Boolean);
}

export function asEntries(value: unknown): ExtensionEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: ExtensionEntry[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      entries.push({ name: item.trim(), title: item.trim(), description: "" });
    } else if (isRecord(item)) {
      const name = asString(item.name);
      const title = asString(item.title) || name;
      if (name || title) {
        entries.push({ name: name || title, title, description: asString(item.description) });
      }
    }
  }
  return entries;
}
