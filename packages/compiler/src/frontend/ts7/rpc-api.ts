// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Ts7Api as ConnectedTs7Api } from "./api.js";
import { Ts7RpcClient } from "./rpc-client.js";
import { TS7_FILE_SYSTEM_CALLBACKS, type Ts7FileSystem } from "./rpc-filesystem.js";
import { spawnTs7Wire } from "./rpc-process.js";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("typescript/package.json"));
const { default: getExePath } = require(join(packageRoot, "lib/getExePath.js")) as { default: () => string };

/** Platform-package discovery and process creation remain at the host
 * boundary. The session itself uses no SDK implementation or Node process.
 * The `tsc --api` server, first match wins:
 * - SCRIPTC_TS7_EXECUTABLE (a path);
 * - the project's own tsc-ts (the scriptc-compiled port of tsgo 7.0.2, which answers the same requests), found from the
 *   working directory as Node finds a package (`node_modules` upward); SCRIPTC_TS7_EXECUTABLE=tsgo skips it;
 * - this package's typescript (tsgo). */
let resolvedExecutable: string | null = null;
export function ts7Executable(): string {
  const named = process.env["SCRIPTC_TS7_EXECUTABLE"];
  if (named && named !== "tsgo") return named;
  if (named !== "tsgo") resolvedExecutable ??= projectTscTs();
  return resolvedExecutable || getExePath();
}

/** tsc-ts's platform executable, found as its own launcher finds it (bin/tsc-ts.js over bin/platforms.js), or "". */
function projectTscTs(): string {
  try {
    const root = dirname(createRequire(join(process.cwd(), "noop.js")).resolve("tsc-ts/package.json"));
    const fromRoot = createRequire(join(root, "package.json"));
    const platforms = fromRoot(join(root, "bin/platforms.js")) as {
      hostPlatform(): string | undefined; packageName(platform: string): string; executableName(): string;
    };
    const platform = platforms.hostPlatform();
    if (platform === undefined) return "";
    const exe = join(dirname(fromRoot.resolve(`${platforms.packageName(platform)}/package.json`)), "lib", platforms.executableName());
    return existsSync(exe) ? exe : "";
  } catch {
    return "";
  }
}

export class Ts7Api extends ConnectedTs7Api {
  constructor(options: { cwd: string; fs: Ts7FileSystem; collectTiming?: boolean }) {
    const timing = options.collectTiming ?? false;
    const args = ["--api", "--cwd", options.cwd, `--callbacks=${TS7_FILE_SYSTEM_CALLBACKS}`];
    if (timing) args.push("--timing");
    const rpc = new Ts7RpcClient(spawnTs7Wire(ts7Executable(), args));
    super(rpc, options.fs, timing);
  }
}
