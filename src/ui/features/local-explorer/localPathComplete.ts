// Tab completion for the path bar, shell-style but React-free so it can be
// unit tested: split the typed value into "directory to list" + "last segment",
// then extend that segment to the longest common prefix of the matches and add
// a trailing "/" when the single match is a directory.
export type CompletionEntry = { name: string; isDir: boolean };

export type CompletionSplit = {
  /** Absolute directory the caller must list to find candidates. */
  listDir: string;
  /** Incomplete last segment being completed ("" right after a "/"). */
  prefix: string;
};

/**
 * Splits a typed path for completion. A trailing slash means "list this
 * directory", so `/Users/` lists `/Users` with an empty prefix, while `/Use`
 * lists `/` with the prefix `Use`.
 */
export function splitCompletionInput(input: string): CompletionSplit {
  const trimmed = input.trim();
  const trailingSlash = trimmed.endsWith("/");
  const norm = trailingSlash ? trimmed.replace(/\/+$/, "") : trimmed;
  const slash = norm.lastIndexOf("/");
  const dirPart = slash < 0 ? "" : norm.slice(0, slash);
  const prefix = trailingSlash ? "" : slash < 0 ? norm : norm.slice(slash + 1);
  const listed = trailingSlash ? norm : dirPart;
  // The root is the only directory whose listed form is empty ("/Use" → "/").
  const listDir = listed === "" ? "/" : listed;
  return { listDir, prefix };
}

/** Longest common prefix of the candidate names, compared case-insensitively. */
export function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let common = names[0];
  for (const name of names) {
    while (
      common.length > 0 &&
      !name.toLowerCase().startsWith(common.toLowerCase())
    ) {
      common = common.slice(0, -1);
    }
    if (common === "") return "";
  }
  return common;
}

/** Joins a directory and a name without producing a double slash at the root. */
export function joinAbsolute(dir: string, name: string): string {
  if (dir === "/" || dir === "") return `/${name}`;
  return `${dir}/${name}`;
}

/** Candidates matching the typed path, directories first, name-sorted. */
export function completionMatches(
  input: string,
  entries: CompletionEntry[],
): CompletionEntry[] {
  const { prefix } = splitCompletionInput(input);
  const needle = prefix.toLowerCase();
  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(needle))
    .sort(
      (a, b) =>
        Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
    );
}

/**
 * Completed value for the typed path, or null when nothing matches. The path is
 * extended to the common prefix of the matches; a single directory match also
 * gets a trailing slash so the next Tab descends into it.
 */
export function completePathInput(
  input: string,
  entries: CompletionEntry[],
): string | null {
  const { listDir } = splitCompletionInput(input);
  const matches = completionMatches(input, entries);
  if (matches.length === 0) return null;
  const common = longestCommonPrefix(matches.map((match) => match.name));
  if (common === "") return null;
  const suffix = matches.length === 1 && matches[0].isDir ? "/" : "";
  return `${joinAbsolute(listDir, common)}${suffix}`;
}
