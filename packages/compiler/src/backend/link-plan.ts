// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
/** Ordered executable link plans for scriptc-owned program objects.
 *
 * The plan is data, not a compiler-driver command line.  Runtime-pack
 * selection owns which objects exist, target specifications own mandatory
 * driver arguments, and this module owns the observable order in which the
 * program, FFI inputs, runtime objects/archives, and system libraries meet
 * the platform linker.
 */
import type { NativeOptimization } from "./optimization.js";
import type { FfiProfile } from "../ffi/ffi-manifest.js";
import type { NativeLinkFeatures } from "./native-link-info.js";
import type { NativeArtifactDependency } from "./native/contracts.js";
import { needsDarwinDebugSymbols } from "./debug-symbols.js";
import { loadRuntimePack, type RuntimePackSelection } from "./runtime-pack.js";
import { executableLinkInputs } from "./link-plan-core.js";
import { hugeTextProgram } from "./huge-text.js";
import { resolveHostLink, type HostLink, type HostLinkOptions } from "./host-island.js";
import type { NativeTargetSpec, WindowsSubsystem } from "./targets.js";

export interface NativeLinkPlan {
  target: NativeTargetSpec;
  outputPath: string;
  /** Object/archive order is intentional. In particular FFI archives must
   * follow the generated program object and precede runtime archives. */
  inputs: string[];
  systemLibraries: string[];
  driverFlags: string[];
  dependencyPaths: string[];
  /** Inputs already snapshotted by the program-object emitter. */
  programObjectDependencies: NativeArtifactDependency[];
  runtimePack: RuntimePackSelection;
  /** The host archive of a host-island link (host-island.ts), already in
   * `inputs`, and the link arguments that follow the system libraries. */
  host?: HostLink;
  darwinDebugSymbols?: boolean;
  /** Linked with `--static`: the linked executable is checked before use. */
  staticLink?: boolean;
  /** Program code large enough for text on huge pages (huge-text.ts). */
  hugeText?: boolean;
  /** The program's start-up functions by symbol, first-reach order: the linker
   * places their code first (function-layout.ts). */
  startupSymbols?: readonly string[];
}

export async function createNativeLinkPlan(options: {
  target: NativeTargetSpec;
  programObject: string;
  programPartitions?: readonly string[];
  outPath: string;
  features: NativeLinkFeatures;
  ffi: FfiProfile | null;
  optimization: NativeOptimization;
  strip?: boolean;
  staticLink?: boolean;
  windowsSubsystem?: WindowsSubsystem;
  profileGenerate?: boolean;
  profileLayout?: boolean;
  /** `false` keeps 4 KiB segment alignment for large program code. */
  hugeText?: boolean;
  startupSymbols?: readonly string[];
  programObjectDependencies?: readonly NativeArtifactDependency[];
  env?: NodeJS.ProcessEnv;
  resolver?: (specifier: string) => string;
  /** The host for a hostIsland link (host-island.ts). */
  host?: HostLinkOptions;
  hostResolver?: (specifier: string) => string;
}): Promise<NativeLinkPlan> {
  if (options.ffi?.frameworks?.length && options.target.platform !== "darwin")
    throw new Error("FFI frameworks require a Darwin target");
  // A static executable cannot load NSS modules, so the pack selects the
  // /etc/passwd build of the os unit for it (SCR_STATIC_PASSWD); every
  // dynamically linked build keeps the getpwuid_r build.
  const runtimePack = await loadRuntimePack({
    ...options,
    features:
      options.staticLink === true ? { ...options.features, staticLink: true } : options.features,
  });
  // A host-island link takes exactly one archive defining scr_host_ops(),
  // after the runtime objects that reference it.
  const host =
    options.features.hostIsland === true
      ? await resolveHostLink({
          target: options.target,
          host: options.host ?? {},
          runtimeHostAbi: runtimePack.manifest.host_abi ?? null,
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.hostResolver === undefined ? {} : { resolver: options.hostResolver }),
        })
      : undefined;
  const hugeText =
    options.hugeText !== false &&
    hugeTextProgram(options.target, [options.programObject, ...(options.programPartitions ?? [])]);
  const inputs = executableLinkInputs({
    target: options.target,
    programObject: options.programObject,
    ...(options.programPartitions === undefined
      ? {}
      : { programPartitions: options.programPartitions }),
    ffiLibraries: options.ffi?.libraries ?? [],
    ffiSystemLibraries: options.ffi?.systemLibraries ?? [],
    ffiFrameworks: options.ffi?.frameworks ?? [],
    runtimeObjects: runtimePack.runtimeObjects,
    runtimeArchives: host === undefined ? runtimePack.archives : [host.archive, ...runtimePack.archives],
    runtimeSystemLibraries: runtimePack.systemLibraries,
    optimization: options.optimization,
    ...(options.strip === undefined ? {} : { strip: options.strip }),
    ...(options.staticLink === true ? { staticLink: true } : {}),
    ...(options.windowsSubsystem === undefined
      ? {}
      : { windowsSubsystem: options.windowsSubsystem }),
    ...(options.profileGenerate === true ? { profileGenerate: true } : {}),
    ...(options.profileLayout === true ? { profileLayout: true } : {}),
  });
  return {
    target: options.target,
    darwinDebugSymbols: needsDarwinDebugSymbols(
      options.target.platform,
      options.optimization,
      options.strip,
    ),
    outputPath: options.outPath,
    ...inputs,
    dependencyPaths: [
      ...runtimePack.dependencyPaths,
      ...(host?.dependencyPaths ?? []),
      ...(options.ffi?.libraries ?? []),
    ],
    programObjectDependencies: [...(options.programObjectDependencies ?? [])],
    runtimePack,
    ...(host === undefined ? {} : { host }),
    // The host's entry points: rooted before the inputs, so the archive
    // members that define them link (and a shared library exports them).
    ...(host !== undefined && host.exports.length > 0
      ? { driverFlags: [...inputs.driverFlags, ...host.exports.map((symbol) => `-Wl,--undefined=${symbol}`)] }
      : {}),
    ...(options.staticLink === true ? { staticLink: true } : {}),
    ...(hugeText ? { hugeText: true } : {}),
    ...(options.startupSymbols === undefined || options.startupSymbols.length === 0
      ? {}
      : { startupSymbols: [...options.startupSymbols] }),
  };
}
