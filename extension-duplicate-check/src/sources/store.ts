import { asEntries, asString, isRecord, manifestToExtension } from "../manifest";
import type { Extension, ExtensionEntry } from "../types";

export interface RedashOptions {
  baseUrl: string;
  queryId: string;
  apiKey: string;
}

/** Fetches the store catalog from the cached results of a Redash query. */
export async function fetchStoreExtensions({ baseUrl, queryId, apiKey }: RedashOptions): Promise<Extension[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/queries/${encodeURIComponent(queryId)}/results.json`;
  const response = await fetch(url, {
    headers: { Authorization: `Key ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Redash query ${queryId} returned HTTP ${response.status} ${response.statusText}`);
  }
  return parseRedashResult(await response.json());
}

/**
 * Turns a Redash `results.json` payload into extensions. Column names are matched loosely (case, `_` and `-` are
 * ignored and common aliases are accepted) and rows describing the same extension, e.g. one row per command, are
 * merged.
 */
export function parseRedashResult(payload: unknown): Extension[] {
  const rows = resultRows(payload);
  if (!rows) {
    if (isRecord(payload) && "job" in payload) {
      throw new Error("Redash has no cached result for the query yet (it returned a job instead of rows)");
    }
    throw new Error("Unexpected Redash response: no rows found");
  }

  const extensions = new Map<string, Extension>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const extension = rowToExtension(row);
    if (!extension) {
      continue;
    }
    const key = `${extension.author ?? ""}/${extension.name}`.toLowerCase();
    const existing = extensions.get(key);
    if (existing) {
      mergeInto(existing, extension);
    } else {
      extensions.set(key, extension);
    }
  }
  return [...extensions.values()];
}

function resultRows(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return undefined;
  }
  const queryResult = isRecord(payload.query_result) ? payload.query_result : payload;
  const data = isRecord(queryResult.data) ? queryResult.data : queryResult;
  return Array.isArray(data.rows) ? data.rows : undefined;
}

const FIELDS = {
  name: ["name", "extension_name", "slug", "extension_slug", "extension", "package_name"],
  title: ["title", "extension_title", "display_name"],
  description: ["description", "extension_description", "summary"],
  author: [
    "author",
    "author_handle",
    "author_username",
    "owner",
    "owner_handle",
    "owner_username",
    "handle",
    "username",
    "user",
    "creator",
  ],
  commands: ["commands", "extension_commands", "command_list"],
  tools: ["tools", "extension_tools", "ai_tools"],
  keywords: ["keywords", "tags"],
  categories: ["categories", "category"],
  url: ["url", "store_url", "extension_url", "link", "store_link"],
  manifest: ["manifest", "package_json", "package", "raw_manifest"],
  commandName: ["command_name"],
  commandTitle: ["command_title"],
  commandDescription: ["command_description"],
} satisfies Record<string, string[]>;

function rowToExtension(row: Record<string, unknown>): Extension | undefined {
  const columns = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    columns.set(columnKey(key), value);
  }
  const get = (field: keyof typeof FIELDS): unknown => {
    for (const alias of FIELDS[field]) {
      const value = columns.get(columnKey(alias));
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  };

  const manifest = parseJson(get("manifest"));
  const base = isRecord(manifest) ? manifestToExtension(manifest, { source: "store" }) : undefined;

  const commands = asEntries(parseList(get("commands")));
  const commandName = asString(get("commandName"));
  const commandTitle = asString(get("commandTitle"));
  if (commandName || commandTitle) {
    commands.push({
      name: commandName || commandTitle,
      title: commandTitle || commandName,
      description: asString(get("commandDescription")),
    });
  }

  const name = asString(get("name")) || base?.name || "";
  const title = asString(get("title")) || base?.title || name;
  if (!name && !title) {
    return undefined;
  }
  const author = authorHandle(get("author")) || base?.author;
  return {
    source: "store",
    name: name || title,
    title,
    description: asString(get("description")) || base?.description || "",
    author,
    commands: commands.length > 0 ? commands : (base?.commands ?? []),
    tools: asEntries(parseList(get("tools"))).concat(base?.tools ?? []),
    keywords: stringList(get("keywords")).concat(base?.keywords ?? []),
    categories: stringList(get("categories")).concat(base?.categories ?? []),
    url: asString(get("url")) || (author && name ? `https://www.raycast.com/${author}/${name}` : undefined),
  };
}

function columnKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function authorHandle(value: unknown): string | undefined {
  const parsed = parseJson(value);
  if (isRecord(parsed)) {
    return asString(parsed.handle) || asString(parsed.username) || asString(parsed.login) || asString(parsed.name);
  }
  return asString(value) || undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!/^[[{"]/.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Accepts JSON arrays, Postgres array literals (`{a,b}`) and comma-separated strings. */
function parseList(value: unknown): unknown[] {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed !== "string") {
    return [];
  }
  const text = parsed.trim().replace(/^\{(.*)\}$/s, "$1");
  return text
    .split(",")
    .map((item) => item.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  return parseList(value)
    .map((item) => (isRecord(item) ? asString(item.name) || asString(item.title) : asString(item)))
    .filter(Boolean);
}

function mergeInto(target: Extension, other: Extension) {
  target.description ||= other.description;
  target.url ||= other.url;
  target.commands = mergeEntries(target.commands, other.commands);
  target.tools = mergeEntries(target.tools, other.tools);
  target.keywords = [...new Set([...target.keywords, ...other.keywords])];
  target.categories = [...new Set([...target.categories, ...other.categories])];
}

function mergeEntries(a: ExtensionEntry[], b: ExtensionEntry[]): ExtensionEntry[] {
  const entries = new Map(a.map((entry) => [entry.name, entry]));
  for (const entry of b) {
    if (!entries.has(entry.name)) {
      entries.set(entry.name, entry);
    }
  }
  return [...entries.values()];
}
