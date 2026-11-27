/** The host island's link (scr_host_island.h): which programs take it, and the host archive that answers its
 * scr_host_ops() vtable.
 *
 * A native program whose page operations or typed host modules (`declare module "host:..."`) need an embedding host
 * links the host island in place of the engine island (runtime packs' hostIsland feature), plus exactly one archive
 * that defines scr_host_ops():
 *
 * - `host: "auto"` (the default): the target's host pack's smallest set that holds the host services the program
 *   reaches (host-features.ts; every service when it reads globals the pass cannot name), with `hostFeatures`'
 *   additions and removals;
 * - `host: "<set>"`: that set of the pack (`full`, `ui`, `headless`, `offline`, or a set the pack adds); `generic` is
 *   `full`;
 * - `hostLib` (or SCRIPTC_HOST_LIB): an embedder's own archive, with `hostLinkArgs` (or SCRIPTC_HOST_LINK_ARGS);
 * - `host: "quickjs"`: no host island; the engine island links as it did before the host island existed.
 *
 * There is no weak default scr_host_ops: the platform linkers disagree on a weak definition inside a static archive,
 * so the choice is which archive links. The host pack is found at SCRIPTW_HOST_PACK (a directory) or as the
 * installed `@scriptw/host-<platform>` package. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IrModule } from "../ir/ir.js";
import { everyStmtList } from "../ir/traverse.js";
import { RuntimePackError } from "./runtime-pack-core.js";
import type { NativeTargetSpec } from "./targets.js";
import {
  HOST_SERVICES,
  isHostService,
  parseHostFeatures,
  selectHostSet,
  type HostReach,
  type HostService,
  type HostSetChoice,
} from "./host-features.js";

/** `auto` (the default), a set of the host pack (`full`, `ui`, `headless`, `offline`, or one the pack adds; `generic`
 * is `full`), or `quickjs` (no host island). */
export type HostChoice = "auto" | "full" | "generic" | "ui" | "headless" | "offline" | "quickjs" | (string & {});

/** The compile options that choose the host. */
export interface HostLinkOptions {
  host?: HostChoice;
  /** With `auto`: services to add (`audio`) or remove (`-rtc`) on top of what the program reaches. */
  hostFeatures?: readonly string[];
  /** Print the chosen set and why (stderr); SCRIPTC_EXPLAIN_HOST=1 does too. */
  explainHost?: boolean;
  /** What the program reaches (host-features.ts hostReach); without it `auto` takes every service. */
  reach?: HostReach;
  /** An embedder's archive defining scr_host_ops(), in place of the host pack's. */
  hostLib?: string;
  /** Link arguments the embedder's archive needs (frameworks, system libraries). */
  hostLinkArgs?: readonly string[];
}

export const HOST_PACK_SCHEMA = "scriptw.host-pack.v1";
export const HOST_PACK_SCHEMA_V2 = "scriptw.host-pack.v2";

/** A host pack's manifest (`host-pack.json`), schema v2: named sets, each one archive and the services it holds. */
export interface HostPackManifestV2 {
  schema: typeof HOST_PACK_SCHEMA_V2;
  abi: number;
  target: string;
  /** In manifest order, which breaks a tie between two equally small sets. */
  sets: Record<string, { path: string; sha256: string; services: HostService[] }>;
  /** Link arguments after the host archive, for every set: the union of their native libraries. */
  linkArgs: string[];
  /** As v1's; every set defines each of them. */
  exports?: string[];
  /** The services each typed `host:` module needs; a module not listed needs every service. */
  modules?: Record<string, HostService[]>;
}

/** A host pack's manifest (`host-pack.json`), schema v1: the `generic` archive (every service) and `headless` (the
 * network alone). Still read: as the sets `full` and `headless`. */
export interface HostPackManifest {
  schema: typeof HOST_PACK_SCHEMA;
  /** SCR_HOST_ABI the archives were built against. */
  abi: number;
  /** The Rust target triple the archives were built for. */
  target: string;
  archives: Partial<Record<"generic" | "headless", { path: string; sha256: string }>>;
  /** Link arguments after the host archive: frameworks and system libraries. */
  linkArgs: string[];
  /** Symbols of the archive the link must keep and export though the program never references them: the entry
   * points a platform calls into the host (an Android host's JNI_OnLoad and Java_* methods). Each is rooted with
   * --undefined, so the archive member that defines it links. */
  exports?: string[];
}

/** The resolved host for one link. */
export interface HostLink {
  archive: string;
  linkArgs: string[];
  /** Files whose content identifies the link (the executable cache's inputs). */
  dependencyPaths: string[];
  /** The pack's SCR_HOST_ABI, or null for an embedder's archive (checked at run time by the island). */
  abi: number | null;
  /** The host's entry points the link roots (HostPackManifest.exports). */
  exports: string[];
  /** The pack set that links (host-features.ts), or absent for an embedder's archive. */
  set?: string;
}

/** The host pack platform for a native target, as the `@scriptw/host-*` packages name it. */
export function hostPackPlatform(target: Pick<NativeTargetSpec, "name">): string | null {
  switch (target.name) {
    case "linux-x64-gnu":
      return "linux-x64-gnu";
    case "windows-x64-msvc":
      return "win32-x64";
    case "macos-arm64":
      return "darwin-arm64";
    case "macos-x64":
      return "darwin-x64";
    case "android-arm64":
      return "android-arm64";
    default:
      return null;
  }
}

export function hostPackPackage(platform: string): string {
  return `@scriptw/host-${platform}`;
}

/** Whether the module reaches an embedding host: a typed host module call (`host.call`). Page operations come with
 * the browser target, which the caller checks itself. */
export function moduleCallsHost(mod: Pick<IrModule, "functions">): boolean {
  let found = false;
  for (const fn of mod.functions) {
    everyStmtList(fn.body, {
      expr: (node) => {
        if (node.kind === "libCall" && node.fn === "host.call") found = true;
        return !found;
      },
      stmt: () => !found,
    });
    if (found) return true;
  }
  return false;
}

/** Whether this build links the host island: a native executable that reaches the host, unless `host: "quickjs"`. */
export function linksHostIsland(options: { browser: boolean; callsHost: boolean; host?: HostChoice }): boolean {
  if (options.host === "quickjs") return false;
  return options.browser || options.callsHost;
}

function invalid(message: string): RuntimePackError {
  return new RuntimePackError(message, "invalid");
}

export function parseHostPackManifest(value: unknown, where: string): HostPackManifest | HostPackManifestV2 {
  if ((value as { schema?: unknown } | null)?.schema === HOST_PACK_SCHEMA_V2) return parseHostPackManifestV2(value, where);
  const m = value as Partial<HostPackManifest> | null;
  const archiveOk = (a: unknown): boolean => {
    const x = a as { path?: unknown; sha256?: unknown } | undefined;
    return (
      x !== undefined &&
      typeof x.path === "string" &&
      !x.path.startsWith("/") &&
      !x.path.split(/[\\/]/).includes("..") &&
      typeof x.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(x.sha256)
    );
  };
  if (
    m === null ||
    typeof m !== "object" ||
    m.schema !== HOST_PACK_SCHEMA ||
    typeof m.abi !== "number" ||
    !Number.isInteger(m.abi) ||
    typeof m.target !== "string" ||
    typeof m.archives !== "object" ||
    m.archives === null ||
    Object.keys(m.archives).some((k) => k !== "generic" && k !== "headless") ||
    !Object.values(m.archives).every(archiveOk) ||
    !Array.isArray(m.linkArgs) ||
    !m.linkArgs.every((a) => typeof a === "string") ||
    (m.exports !== undefined &&
      (!Array.isArray(m.exports) || !m.exports.every((s) => typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))))
  ) {
    throw invalid(`${where} is not a valid host pack manifest`);
  }
  return m as HostPackManifest;
}

function archiveEntryOk(a: unknown): boolean {
  const x = a as { path?: unknown; sha256?: unknown } | undefined;
  return (
    x !== undefined &&
    x !== null &&
    typeof x.path === "string" &&
    !x.path.startsWith("/") &&
    !x.path.split(/[\\/]/).includes("..") &&
    typeof x.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(x.sha256)
  );
}

function servicesOk(v: unknown): boolean {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && isHostService(s));
}

function parseHostPackManifestV2(value: unknown, where: string): HostPackManifestV2 {
  const m = value as Partial<HostPackManifestV2>;
  if (
    typeof m.abi !== "number" ||
    !Number.isInteger(m.abi) ||
    typeof m.target !== "string" ||
    typeof m.sets !== "object" ||
    m.sets === null ||
    Object.keys(m.sets).length === 0 ||
    !Object.keys(m.sets).every((k) => /^[a-z][a-z0-9-]*$/.test(k) && k !== "auto" && k !== "quickjs" && k !== "generic") ||
    !Object.values(m.sets).every((x) => archiveEntryOk(x) && servicesOk((x as { services?: unknown }).services)) ||
    !Array.isArray(m.linkArgs) ||
    !m.linkArgs.every((a) => typeof a === "string") ||
    (m.exports !== undefined &&
      (!Array.isArray(m.exports) || !m.exports.every((s) => typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)))) ||
    (m.modules !== undefined &&
      (typeof m.modules !== "object" || m.modules === null || !Object.values(m.modules).every(servicesOk)))
  ) {
    throw invalid(`${where} is not a valid host pack manifest`);
  }
  return m as HostPackManifestV2;
}

/** A pack's sets in manifest order, each with its archive and services: v2's own, or v1's `generic` as `full`
 * (every service) and `headless` as `headless` (the network). */
export function hostPackSets(
  manifest: HostPackManifest | HostPackManifestV2,
): (HostSetChoice & { path: string; sha256: string })[] {
  if (manifest.schema === HOST_PACK_SCHEMA_V2) {
    return Object.entries(manifest.sets).map(([name, set]) => ({ name, path: set.path, sha256: set.sha256, services: set.services }));
  }
  const out: (HostSetChoice & { path: string; sha256: string })[] = [];
  if (manifest.archives.generic) out.push({ name: "full", ...manifest.archives.generic, services: [...HOST_SERVICES] });
  if (manifest.archives.headless) out.push({ name: "headless", ...manifest.archives.headless, services: ["net"] });
  return out;
}

/** The host for a host-island link, checked against the runtime pack's host ABI (`runtimeHostAbi`, null when the
 * runtime pack has no host-island units). */
export async function resolveHostLink(options: {
  target: Pick<NativeTargetSpec, "name">;
  host: HostLinkOptions;
  runtimeHostAbi: number | null;
  env?: NodeJS.ProcessEnv;
  resolver?: (specifier: string) => string;
}): Promise<HostLink> {
  const env = options.env ?? process.env;
  if (options.runtimeHostAbi === null) {
    throw new RuntimePackError(
      `the runtime pack for ${options.target.name} has no host island units; it predates the host island`,
      "invalid",
      "rebuild or reinstall the runtime pack, or build with --host=quickjs",
    );
  }
  const hostLib = options.host.hostLib ?? (env["SCRIPTC_HOST_LIB"] || undefined);
  const choice = options.host.host ?? "auto";
  const features = options.host.hostFeatures ?? (env["SCRIPTC_HOST_FEATURES"] ? [env["SCRIPTC_HOST_FEATURES"]] : []);
  if (features.length > 0 && (choice !== "auto" || hostLib !== undefined)) {
    throw new RuntimePackError(
      hostLib !== undefined
        ? "--host-features chooses among a host pack's sets; --host-lib links your own archive"
        : `--host-features applies to --host auto; --host ${choice} names its set`,
      "invalid",
    );
  }
  if (hostLib !== undefined) {
    const linkArgs =
      options.host.hostLinkArgs !== undefined
        ? [...options.host.hostLinkArgs]
        : (env["SCRIPTC_HOST_LINK_ARGS"] ?? "").split(/\s+/).filter((a) => a !== "");
    const archive = resolve(hostLib);
    try {
      await readFile(archive);
    } catch {
      throw new RuntimePackError(`the host archive ${archive} could not be read`, "missing");
    }
    return { archive, linkArgs, dependencyPaths: [archive], abi: null, exports: [] };
  }
  const platform = hostPackPlatform(options.target);
  if (platform === null) {
    throw new RuntimePackError(
      `no host pack exists for ${options.target.name}`,
      "unsupported",
      "build with --host-lib <archive> to link your own scr_host_ops(), or --host=quickjs",
    );
  }
  const packageName = hostPackPackage(platform);
  let root: string;
  const explicit = env["SCRIPTW_HOST_PACK"];
  if (explicit !== undefined && explicit !== "") {
    root = resolve(explicit);
  } else {
    const resolvePackageJson =
      options.resolver ?? ((specifier: string) => createRequire(import.meta.url).resolve(specifier));
    try {
      root = dirname(resolvePackageJson(`${packageName}/package.json`));
    } catch {
      throw new RuntimePackError(
        `the host pack ${packageName} is not installed; a program that uses page APIs or host: modules links the host for ${options.target.name} from it`,
        "missing",
        `install ${packageName}, set SCRIPTW_HOST_PACK to a host pack directory, or build with --host-lib <archive> or --host=quickjs`,
      );
    }
  }
  const manifestPath = join(root, "host-pack.json");
  let manifest: HostPackManifest | HostPackManifestV2;
  try {
    manifest = parseHostPackManifest(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
  } catch (error) {
    if (error instanceof RuntimePackError) throw error;
    throw invalid(`could not read ${manifestPath}`);
  }
  if (manifest.abi !== options.runtimeHostAbi) {
    throw new RuntimePackError(
      `the host pack at ${root} implements host ABI ${manifest.abi}, but the runtime pack's host island is ABI ${options.runtimeHostAbi}`,
      "invalid",
      "install the host pack and runtime pack of one release",
    );
  }
  const sets = hostPackSets(manifest);
  let flavor: string;
  if (choice === "auto") {
    let request;
    try {
      request = parseHostFeatures(features);
    } catch (error) {
      throw new RuntimePackError((error as Error).message, "invalid");
    }
    const reach = options.host.reach ?? { services: [], modules: [], opaque: { what: "a link without the program's reach", loc: { file: "", start: 0, end: 0 } }, first: {}, firstModule: {} };
    let selection;
    try {
      selection = selectHostSet({
        sets,
        reach,
        request,
        ...(manifest.schema === HOST_PACK_SCHEMA_V2 && manifest.modules !== undefined ? { moduleServices: manifest.modules } : {}),
        // An Android host starts from its Activity, which the window's libmatoya answers.
        platformRequires: options.target.name.startsWith("android") ? ["window"] : [],
      });
    } catch (error) {
      throw new RuntimePackError(
        `the host pack at ${root}: ${(error as Error).message}`,
        "invalid",
        "build with --host <set> to name one, or --host-features to add or remove a service",
      );
    }
    flavor = selection.set;
    if (options.host.explainHost === true || env["SCRIPTC_EXPLAIN_HOST"] === "1") {
      process.stderr.write(
        `host set ${flavor} (${selection.required.length === 0 ? "no service" : selection.required.join(", ")}` +
          `${selection.excluded.length === 0 ? "" : `; without ${selection.excluded.join(", ")}`}): ${selection.reason}\n`,
      );
    }
  } else {
    flavor = choice === "generic" ? "full" : choice;
    if (options.host.explainHost === true || env["SCRIPTC_EXPLAIN_HOST"] === "1") {
      process.stderr.write(`host set ${flavor}: --host ${choice}\n`);
    }
  }
  const entry = sets.find((set) => set.name === flavor);
  if (entry === undefined) {
    throw new RuntimePackError(
      `the host pack at ${root} has no ${flavor} archive (its sets: ${sets.map((set) => set.name).join(", ")})`,
      "invalid",
    );
  }
  const archive = join(root, entry.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(archive);
  } catch {
    throw invalid(`host pack archive is missing: ${entry.path}`);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw invalid(`host pack archive hash mismatch: ${entry.path}`);
  }
  return {
    archive,
    linkArgs: [...manifest.linkArgs],
    dependencyPaths: [manifestPath, archive],
    set: flavor,
    abi: manifest.abi,
    exports: [...(manifest.exports ?? [])],
  };
}

/** The host choice as an executable cache key part: undefined in the default posture (no option and no host
 * environment variable), so programs that never reach a host keep their keys. */
export function hostCacheIdentity(host: HostLinkOptions, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const parts = [
    host.host === undefined || host.host === "auto" ? null : `choice=${host.host === "generic" ? "full" : host.host}`,
    host.hostFeatures === undefined || host.hostFeatures.length === 0 ? null : `features=${[...host.hostFeatures].join(",")}`,
    host.hostLib === undefined ? null : `lib=${resolve(host.hostLib)}`,
    host.hostLinkArgs === undefined ? null : `link=${host.hostLinkArgs.join("\x1f")}`,
    ...["SCRIPTC_HOST_LIB", "SCRIPTC_HOST_LINK_ARGS", "SCRIPTW_HOST_PACK", "SCRIPTC_HOST_FEATURES"].map((name) =>
      env[name] === undefined || env[name] === "" ? null : `${name}=${env[name]}`,
    ),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? undefined : parts.join("\0");
}
