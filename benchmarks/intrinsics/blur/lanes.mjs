// The blur app's extra lanes: four worker threads over shared memory (threads=shared), and the task ring's
// owner-thread drain (threads=off), running the same kernel.
import { spawnSync } from "node:child_process";
import path from "node:path";

export default async function ({ dir }) {
  const lane = (mode, note) => {
    const r = spawnSync(process.execPath, [path.join(dir, "threads.ts"), mode], { encoding: "utf8", cwd: dir });
    return r.status === 0 ? { stdout: r.stdout, note } : { error: r.stderr.slice(0, 300) };
  };
  return {
    "js threads=shared": lane("shared", "4 worker_threads over SharedArrayBuffer, bands claimed from a WorkCounter"),
    "js threads=off (task ring)": lane("ring", "createTaskRing threads=off: each band published and drained on the owner thread"),
  };
}
