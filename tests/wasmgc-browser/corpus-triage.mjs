// Group a corpus-js report's emitted-behavior failures (mismatch, trap, crash,
// runtime-fence) by a normalised signature, so equivalent failures are fixed
// once, by root cause, rather than per corpus filename.
//   node corpus-triage.mjs [report.json]     (default: newest native report)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportsDir } from "./fixture-dirs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? fs.readdirSync(reportsDir).filter((f) => f.startsWith("corpus-js-native-")).map((f) => path.join(reportsDir, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const report = JSON.parse(fs.readFileSync(file, "utf8"));
const signature = (r) => {
  const reason = (r.reason ?? "").replace(/\(in [^)]*\)/g, "").replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N");
  if (r.status === "mismatch") {
    const err = reason.match(/; (?:Uncaught )?([A-Z][a-zA-Z]*Error[^;]*)$/)?.[1];
    return err ? `mismatch with ${err.slice(0, 90)}` : "mismatch (output differs, no error)";
  }
  return `${r.status}: ${reason.slice(0, 110)}`;
};
const groups = new Map();
for (const r of report.results) {
  if (!["mismatch", "trap", "crash", "runtime-fence"].includes(r.status)) continue;
  const k = signature(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
console.log(`${path.basename(file)}: ${JSON.stringify(report.counts)}\n`);
for (const [k, rs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(rs.length).padStart(3)}  ${k}`);
  for (const r of rs.slice(0, 6)) console.log(`       ${r.file}${r.status === "mismatch" ? "  " + (r.reason ?? "").slice(0, 150) : ""}`);
}
