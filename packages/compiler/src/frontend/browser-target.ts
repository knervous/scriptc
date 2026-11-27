// The enums alone: this module holds compile-scoped flags the IR and both backends read, and must not pull in the
// tsgo host (the adapter) for one SyntaxKind.
import { SyntaxKind } from "./ts7/enums.js";
import { remapSourcePath, type SourcePathPrefixMap } from "../source-paths.js";
/* The browser target (WasmGC experiment): DOM programs compile with the
 * page's engine as the dynamic island. When on, `lib.dom` joins the program,
 * DOM declarations map to island handles (jsval) like an npm package's
 * .d.ts, and reads of ambient DOM globals (`document`, `window`, ...) become
 * island globalGet reads instead of Node's ReferenceError.
 *
 * Compile-scoped state: compile() sets it on entry for every request (the
 * experiment avoids threading a new option through each layer). */
let browser = false;
export const setBrowserTarget = (on: boolean): void => { browser = on; };
export const browserTarget = (): boolean => browser;
/** Batch compiles (test runners): every compile of a batch loads ONE program
 * rooted at all the batch's entries and lowers its own entry from it.
 * Requires the shared tsgo host (SCRIPTC_SHARE_TS7_HOST=1) and unchanging files. */
/** Browser target with untyped JS as compiled wasm values (dynModel "native"):
 * JS rest parameters take the dyn ABI instead of the island's engine array. */
let native = false;
export const setNativeDyn = (on: boolean): void => { native = on; };
export const nativeDyn = (): boolean => native;
/** Opt-in browser/native TS any values use checked Wasm storage, including host references. */
let nativeAny = false;
export const setNativeAny = (on: boolean): void => { nativeAny = on; };
export const nativeAnyEnabled = (): boolean => nativeAny;
/** The native host (hostHandles) with native dyn: the page cannot enumerate or read a compiled value, so surfaces that would marshal one
 * to the page (Object.keys over a typed record) stay compiled-side. */
/** Typed host modules (HOST_IMPORT_ABI section 7): refuse, rather than leave on the untyped page-module path, a host module the typed ABI cannot express. */
let strictHostModules = false;
export const setStrictHostModules = (on: boolean): void => { strictHostModules = on; };
export const strictHostModulesEnabled = (): boolean => strictHostModules;
/** Typed host modules: the specifier schemes (`host` for `host:fetch`) whose ambient `declare module` declarations take the typed
 * import path (CompileBaseOptions.hostModuleSchemes). Null, the default: every scheme except `node:`. */
let hostModuleSchemes: ReadonlySet<string> | null = null;
export const setHostModuleSchemes = (schemes: readonly string[] | undefined): void => {
  hostModuleSchemes = schemes === undefined ? null : new Set(schemes.map((s) => s.replace(/:$/, "").toLowerCase()));
};
/** Whether `spec` is a `scheme:name` specifier of a typed host-module scheme (never `node:`, a package or a relative path). */
export const isHostModuleScheme = (spec: string): boolean => {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(spec)?.[1]?.toLowerCase();
  if (scheme === undefined || scheme === "node") return false;
  return hostModuleSchemes === null || hostModuleSchemes.has(scheme);
};
/** Production builds: no source sites in runtime text (CompileBaseOptions.stripSourceSites). */
let stripSites = false;
export const setStripSourceSites = (on: boolean): void => { stripSites = on; };
export const stripSourceSites = (): boolean => stripSites;
/** Source paths as runtime text shows them (CompileBaseOptions.sourcePathPrefixMap): stack frames, refusal and fence
 * messages. Empty: the paths as the program was loaded from. */
let sourcePathMap: SourcePathPrefixMap = [];
export const setSourcePathPrefixMap = (map: SourcePathPrefixMap): void => { sourcePathMap = map; };
export const sourcePathPrefixMap = (): SourcePathPrefixMap => sourcePathMap;
export const sourceSitePath = (file: string): string => remapSourcePath(file, sourcePathMap);
/** A module id (`file:<path>`, `builtin:<name>`) as runtime text and type keys carry it: a file's path through the
 * prefix map. The compiler's own lookups keep the loaded path (sourceFileOfModuleNamespace). */
export const runtimeModuleId = (id: string): string => (id.startsWith("file:") && sourcePathMap.length > 0 ? `file:${sourceSitePath(id.slice("file:".length))}` : id);
/** The program lowers for the LLVM lane (outputKind exe, obj, llvm or asm): native OS threads exist there, so the
 * Atomics surface lowers to real atomics and waits (lowerAtomicsCall). WasmGC and analysis leave it off. */
let llvmLane = false;
export const setLlvmLane = (on: boolean): void => { llvmLane = on; };
export const llvmLaneTarget = (): boolean => llvmLane;
let hostHandles = false;
export const setHostHandles = (on: boolean): void => { hostHandles = on; };
export const hostHandlesEnabled = (): boolean => hostHandles;
/** Opt-in: structural record types a program class flows into map to a
 * record-or-class union (interface-class-arms.ts). */
let interfaceClassArms = false;
export const setInterfaceClassArms = (on: boolean): void => { interfaceClassArms = on; };
export const interfaceClassArmsEnabled = (): boolean => interfaceClassArms;
/** Bundler-style constant definitions (CompileBaseOptions.define): dotted
 * free-name expression -> its JSON literal value. */
let defineTable: ReadonlyMap<string, string | number | boolean | null> = new Map();
export const setDefines = (table: ReadonlyMap<string, string | number | boolean | null>): void => { defineTable = table; };
export const defines = (): ReadonlyMap<string, string | number | boolean | null> => defineTable;
let batch: readonly string[] | null = null;
export const setBatchRoots = (roots: readonly string[] | null): void => { batch = roots && roots.length ? roots : null; };
export const batchRoots = (): readonly string[] | null => batch;
/** TypeScript's DOM library files. */
export const isDomLibFile = (fileName: string): boolean => /[\\/]lib\.(dom|webworker)[a-z.]*\.d\.ts$/.test(fileName);
/** @types/node's declarations of the web globals the DOM library ALSO declares and that the
 * page owns -- `fetch`/`Response`/`Headers`/`Request` and `navigator`. Newer @types/node merges them
 * in unconditionally beside lib.dom, so a symbol like `Response` carries both. On the browser
 * target the page's is the real one (DOM wins): these files are not the static stdlib there. */
export const isNodeWebGlobalMirror = (fileName: string): boolean => /[\\/]@types[\\/]node[\\/]web-globals[\\/](fetch|navigator)\.d\.ts$/.test(fileName);
/** TypeScript's bundled ECMAScript library files (lib.es5.d.ts, lib.es2020.intl.d.ts, ...). */
export const isEsLibFile = (fileName: string): boolean => /[\\/]lib\.es[a-z0-9.]*\.d\.ts$/.test(fileName);
/** Browser target: a declaration the page owns, as an island handle rather
 * than a static stdlib surface: the DOM library's, and the ECMA-402 `Intl`
 * namespace (locale data is the page engine's ICU; a compiled copy would be
 * a second, divergent one). */
export const isPageOwnedDecl = (decl: { getSourceFile(): { fileName: string }; parent?: unknown; kind: number; name?: unknown }): boolean => {
  const file = decl.getSourceFile().fileName;
  if (isDomLibFile(file) || isNodeWebGlobalMirror(file)) return true;
  if (!isEsLibFile(file)) return false;
  for (let node: any = decl; node; node = node.parent) {
    if (node.kind === SyntaxKind.ModuleDeclaration && node.name?.text === "Intl") return true;
  }
  return false;
};
/** The global the browser host installs for `import.meta` ({ env, url }). */
export const BROWSER_IMPORT_META = "__wasmgcImportMeta";

/** The project's own declaration files (global augmentations, env types):
 * every .d.ts under the tsconfig's `include` directories. */
export function projectDeclarationRoots(configFile: string | null, read: (p: string) => string | undefined, list: (dir: string) => { name: string; dir: boolean }[]): string[] {
  if (!configFile) return [];
  const text = (read(configFile) ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
  let include: string[] = [];
  try { include = (JSON.parse(text) as { include?: string[] }).include ?? []; } catch { return []; }
  const base = configFile.replace(/[\\/][^\\/]*$/, "");
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    for (const e of list(dir)) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const path = `${dir}/${e.name}`;
      if (e.dir) walk(path, depth + 1);
      else if (e.name.endsWith(".d.ts")) out.push(path);
    }
  };
  for (const inc of include) if (!/[*?]/.test(inc)) walk(`${base}/${inc}`.replace(/\/\.\//g, "/"), 0);
  return out;
}

/** Specifiers the page's bundler resolves, not the compiler: asset queries
 * (`./x.wasm?url`, `?raw`, `?worker`) and scheme-named virtual modules
 * (`virtual:...`, `host:...`; never `node:`). On the browser target they
 * are host-provided modules: instantiateWasmGc({ modules }) keyed by the
 * specifier as written. */
export const isBundlerSpecifier = (spec: string): boolean =>
  /\?[a-z]/i.test(spec) || (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !spec.startsWith("node:")) || isHostModule(spec);

/** Modules the page keeps as JavaScript (compile option `hostModules`, e.g.
 * a page-side facade "@app/engine"): an entry names a specifier or a prefix
 * ("@babylonjs" covers "@babylonjs/core/..."). They come from the host like
 * npm packages and their source is never compiled. */
let hostModules: readonly string[] = [];
export const setHostModules = (list: readonly string[]): void => { hostModules = list; };
export const isHostModule = (spec: string): boolean =>
  browser && hostModules.some(m => spec === m || spec.startsWith(m + "/"));
