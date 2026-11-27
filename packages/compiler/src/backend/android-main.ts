/** The android-main output (`nativeOutput: "android-main"`): an Android arm64 program linked as one shared library,
 * `libmain.so`, whose exported `main` an Activity calls once it has loaded the library (a native-activity glue such as
 * the one the host pack's Android build carries). It is not an executable: the link is `-shared` with soname
 * libmain.so, and a version script keeps `main` and the JNI entry points (`JNI_OnLoad`, `Java_*`) global and every
 * other symbol local.
 *
 * The link runs the NDK's own clang (`toolchains/llvm/prebuilt/<host>/bin/clang --target=aarch64-linux-android26`)
 * against its sysroot, found the way the library lane finds it (driver.ts androidNdkSysroot: ANDROID_NDK_ROOT,
 * ANDROID_NDK_HOME, then the newest ndk/<version> under ANDROID_HOME, ANDROID_SDK_ROOT or the platform's SDK
 * location). The NDK is never shipped: its bionic stubs and headers come with the user's own install. The NDK's
 * libunwind and compiler-rt are the ones a Rust host built for aarch64-linux-android expects. */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { androidNdkSysroot } from "./native/driver.js";
import { RuntimePackError } from "./runtime-pack-core.js";
import type { NativeTargetSpec } from "./targets.js";

export type NativeOutput = "executable" | "android-main";

/** The symbols libmain.so exports; every other symbol is local. `main` is the one exact name (the program defines
 * it); the JNI and native-activity entry points are patterns, since only a host's Android glue defines them and lld
 * refuses an exact name that nothing defines. */
export const ANDROID_MAIN_VERSION_SCRIPT = `{
  global:
    main;
    JNI_On*;
    Java_*;
    ANativeActivity_on*;
  local:
    *;
};
`;

/** The NDK's clang and sysroot for the android-main link. */
export function androidNdkToolchain(env: NodeJS.ProcessEnv = process.env): { clang: string; sysroot: string } {
  let sysroot: string;
  try {
    sysroot = androidNdkSysroot(env);
  } catch (error) {
    throw new RuntimePackError(
      error instanceof Error ? error.message : String(error),
      "missing",
      "install an NDK with sdkmanager 'ndk;30.0.16248370' (Android Studio's SDK Manager) and set ANDROID_NDK_ROOT to it",
    );
  }
  const clang = join(dirname(sysroot), "bin", process.platform === "win32" ? "clang.exe" : "clang");
  if (!existsSync(clang)) {
    throw new RuntimePackError(`the Android NDK's clang is missing: ${clang}`, "missing");
  }
  return { clang, sysroot };
}

/** The android-arm64 target as the android-main link sees it: the NDK clang as the linker, a shared library with the
 * libmain.so soname and the version script at `versionScript`. */
export function androidMainTarget(
  base: NativeTargetSpec,
  versionScript: string,
  env: NodeJS.ProcessEnv = process.env,
  hostIsland = false,
): NativeTargetSpec {
  if (base.name !== "android-arm64") {
    throw new RuntimePackError(
      `the android-main output links Android arm64 only; the selected target is ${base.name}`,
      "unsupported",
    );
  }
  const { clang, sysroot } = androidNdkToolchain(env);
  return {
    ...base,
    defaultLinker: clang,
    defaultLinkerArgs: [],
    linkerTargetTriple: "aarch64-linux-android26",
    executableLinkerArgs: [
      "-target",
      "aarch64-linux-android26",
      "--sysroot",
      sysroot,
      "-shared",
      "-Wl,-soname,libmain.so",
      `-Wl,--version-script=${versionScript}`,
      "-Wl,--gc-sections",
      "-Wl,-z,relro,-z,now",
      // Android 15+ devices with 16 KB pages load only libraries whose segments are 16 KB aligned.
      "-Wl,-z,max-page-size=16384",
      // An unresolved symbol is a link error, as in an executable: a shared library would otherwise defer it to
      // dlopen on the device.
      "-Wl,--no-undefined",
      // A host-island program's main is started by the host's Activity glue; the wrap lets the runtime record the
      // thread it runs on (scr_host_android.c __wrap_main).
      ...(hostIsland ? ["-Wl,--wrap=main"] : []),
    ],
  };
}

export async function writeAndroidMainVersionScript(path: string): Promise<string> {
  await writeFile(path, ANDROID_MAIN_VERSION_SCRIPT);
  return path;
}
