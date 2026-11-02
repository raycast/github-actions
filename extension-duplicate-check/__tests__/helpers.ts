import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../src/manifest";
import { parseRedashResult } from "../src/sources/store";
import type { Extension } from "../src/types";

const FIXTURES = join(import.meta.dirname, "fixtures");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export function storeFixture(): Extension[] {
  return parseRedashResult(JSON.parse(fixture("store-results.json")));
}

export function manifestFixture(name: string, meta: Partial<Extension> = {}): Extension {
  const extension = parseManifest(fixture(`${name}.package.json`), {
    source: "pull-request",
    path: `extensions/${name}/package.json`,
    ...meta,
  });
  if (!extension) {
    throw new Error(`Invalid fixture ${name}`);
  }
  return extension;
}
