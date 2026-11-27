/** The fork's companion packages (`@scriptw/llvm-*`, `@scriptw/runtime-*`, `@scriptw/host-*`): the same artifacts as
 * upstream's `@scriptc/*` packages under the fork's scope, resolved first, with upstream's names as the fallback. A
 * directory in SCRIPTW_LLVM_PACK or SCRIPTW_RUNTIME_PACK (as SCRIPTW_HOST_PACK for the host, host-island.ts) is used
 * before either name.
 *
 * The fork names five platforms. Windows is `win32-x64` in every family: its lane is the Zig/MinGW link. */
const ALIASES: Record<string, string> = {
  "@scriptc/llvm-linux-x64-gnu": "@scriptw/llvm-linux-x64-gnu",
  "@scriptc/llvm-win32-x64-msvc": "@scriptw/llvm-win32-x64",
  "@scriptc/llvm-darwin-arm64": "@scriptw/llvm-darwin-arm64",
  "@scriptc/llvm-darwin-x64": "@scriptw/llvm-darwin-x64",
  "@scriptc/runtime-linux-x64-gnu": "@scriptw/runtime-linux-x64-gnu",
  "@scriptc/runtime-win32-x64-msvc": "@scriptw/runtime-win32-x64",
  "@scriptc/runtime-darwin-arm64": "@scriptw/runtime-darwin-arm64",
  "@scriptc/runtime-darwin-x64": "@scriptw/runtime-darwin-x64",
  "@scriptc/runtime-android-arm64": "@scriptw/runtime-android-arm64",
};

/** The `@scriptw/*` name of an upstream companion package, or null when the fork names no such platform. */
export function scriptwPackageAlias(upstream: string): string | null {
  return ALIASES[upstream] ?? null;
}

/** Whether `name` is `upstream` or its `@scriptw/*` alias. */
export function isCompanionPackage(name: string | undefined, upstream: string): boolean {
  return name === upstream || (name !== undefined && name === scriptwPackageAlias(upstream));
}

/** The package.json of a companion: the override directory, else the `@scriptw/*` alias, else the upstream name.
 * Throws the resolver's error for the upstream name when none resolves. */
export function resolveCompanionPackageJson(
  upstream: string,
  resolve: (specifier: string) => string,
  overrideDir: string | undefined,
  join: (...parts: string[]) => string,
): string {
  if (overrideDir !== undefined && overrideDir !== "") return join(overrideDir, "package.json");
  const alias = scriptwPackageAlias(upstream);
  if (alias !== null) {
    try {
      return resolve(`${alias}/package.json`);
    } catch {
      // fall through to upstream's name
    }
  }
  return resolve(`${upstream}/package.json`);
}
