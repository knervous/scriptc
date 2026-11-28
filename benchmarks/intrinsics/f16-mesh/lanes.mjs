// The f16 app's extra lane: the package's plain-JavaScript entry (f16.engine.mjs), which uses the engine's conversion
// where it has one, running main.ts's work.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default async function ({ dir }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "f16-engine-"));
  const src = fs.readFileSync(path.join(dir, "main.ts"), "utf8")
    .replace('"../../../packages/intrinsics/f16.ts"', JSON.stringify(path.resolve(dir, "../../../packages/intrinsics/f16.engine.mjs")))
    .replace('"../common/input.ts"', JSON.stringify(path.resolve(dir, "../common/input.ts")));
  const file = path.join(work, "main-engine.ts");
  fs.writeFileSync(file, src);
  fs.writeFileSync(path.join(work, "package.json"), '{ "type": "module" }\n');
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  fs.rmSync(work, { recursive: true, force: true });
  return { "js+fallback (engine)": r.status === 0 ? { stdout: r.stdout, note: "f16.engine.mjs: Math.f16round/DataView float16 where the engine has them" } : { error: r.stderr.slice(0, 300) } };
}
