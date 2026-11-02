export interface ExtensionEntry {
  name: string;
  title: string;
  description: string;
}

export type ExtensionSource = "store" | "pull-request";

/** A Raycast extension normalized from a package.json manifest or a store catalog row. */
export interface Extension {
  source: ExtensionSource;
  name: string;
  title: string;
  description: string;
  author?: string;
  commands: ExtensionEntry[];
  tools: ExtensionEntry[];
  keywords: string[];
  categories: string[];
  /** Store page or pull request URL. */
  url?: string;
  /** Path of the manifest in raycast/extensions, e.g. `extensions/foo/package.json`. */
  path?: string;
  pullRequest?: {
    number: number;
    title: string;
    author?: string;
  };
}
