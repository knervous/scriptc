/** A list of `[from, to]` source path prefixes (CompileBaseOptions.sourcePathPrefixMap). */
export type SourcePathPrefixMap = readonly (readonly [string, string])[];

/** A source path as runtime text shows it (stack frames, refusal and fence messages), remapped the way a C
 * compiler's `-ffile-prefix-map` remaps `__FILE__`: the first `[from, to]` whose `from` is a prefix of the path
 * (compared with `/` separators, and case-insensitively when `from` starts with a drive letter) is replaced by `to`.
 * An unmatched path, or an empty map, gives the path unchanged. */
export function remapSourcePath(file: string, map: SourcePathPrefixMap): string {
  if (map.length === 0) return file;
  const path = file.replaceAll("\\", "/");
  for (const [from, to] of map) {
    const prefix = from.replaceAll("\\", "/");
    if (prefix === "") continue;
    const head = path.slice(0, prefix.length);
    if (/^[A-Za-z]:/.test(prefix) ? head.toLowerCase() === prefix.toLowerCase() : head === prefix) return to + path.slice(prefix.length);
  }
  return file;
}
