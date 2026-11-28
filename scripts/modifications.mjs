#!/usr/bin/env node
// MODIFICATIONS.md and the in-place modification notices: section 4(b) of the Apache License, Version 2.0 (LICENSE),
// against the upstream scriptc commit this tree is compared with.
//
//   node scripts/modifications.mjs            write MODIFICATIONS.md and add or remove the in-place notices
//   node scripts/modifications.mjs --check    exit 1 if MODIFICATIONS.md or a notice is out of date (CI)
//   node scripts/modifications.mjs --manifest=<upstream checkout> [--rev=<commit>]
//                                             rewrite the upstream manifest from a checkout of
//                                             https://github.com/vercel-labs/scriptc at <commit> (default HEAD)
//
// The upstream side is scripts/modifications-upstream.tsv, a committed manifest of upstream's files at the pinned
// commit (git blob id, mode and path), so the check needs no network. When this tree is rebased on a newer upstream,
// clone upstream, check out the new commit and rewrite the manifest with --manifest, then run this script without
// options and review the regenerated MODIFICATIONS.md and the notices it adds or removes.
//
// The tree is the files git tracks here, less MODIFICATIONS.md itself and a top-level private/ directory (a working
// checkout may keep one beside the public tree). A tracked file is:
// - modified when upstream has the path with other content (the content compared without its notice line);
// - added when upstream lacks the path;
// - and an upstream path the tree lacks is removed.
//
// The in-place notice is one comment line at the top of each modified implementation source (after a shebang). Tests,
// fixtures and benches carry none (MODIFICATIONS.md lists them): a line added to them would move the line numbers their
// expected outputs and snapshots carry. Generated files carry none either: their generators' --check modes compare
// them byte for byte, and regenerating would drop the line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "scripts/modifications-upstream.tsv");
const outputPath = path.join(root, "MODIFICATIONS.md");
const NOTICE = "This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.";
const UPSTREAM_URL = "https://github.com/vercel-labs/scriptc";

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const check = args.includes("--check");
for (const a of args) {
  if (a !== "--check" && !/^--(manifest|rev)=/.test(a)) {
    console.error(`modifications: unknown argument ${a}`);
    process.exit(2);
  }
}

// Paths sort by their UTF-8 bytes, as git orders them.
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

if (opt("manifest") !== undefined) {
  writeManifest(path.resolve(opt("manifest")), opt("rev") ?? "HEAD");
  process.exit(0);
}

// The upstream manifest: a header naming the commit, then `<blob id>\t<mode>\t<path>` per file.
function writeManifest(dir, rev) {
  const commit = execFileSync("git", ["-C", dir, "rev-parse", `${rev}^{commit}`], { encoding: "utf8" }).trim();
  const lines = execFileSync("git", ["-C", dir, "ls-tree", "-r", "-z", commit], { encoding: "utf8", maxBuffer: 1 << 30 })
    .split("\0").filter(Boolean).map((line) => {
      const [meta, file] = line.split("\t");
      const [mode, type, object] = meta.split(" ");
      if (type !== "blob") throw new Error(`modifications: ${file} is a ${type}, not a blob`);
      if (/[\t\n]/.test(file)) throw new Error(`modifications: ${JSON.stringify(file)} has a tab or newline`);
      return { file, line: `${object}\t${mode}\t${file}` };
    }).sort((a, b) => byBytes(a.file, b.file)).map((e) => e.line);
  fs.writeFileSync(manifestPath, [
    `# upstream ${UPSTREAM_URL} ${commit}`,
    "# Written by scripts/modifications.mjs --manifest; see that script before editing.",
    ...lines,
    "",
  ].join("\n"));
  console.log(`modifications: wrote ${path.relative(root, manifestPath)} (${lines.length} files at ${commit})`);
}

function readManifest() {
  const text = fs.readFileSync(manifestPath, "utf8");
  const header = /^# upstream \S+ ([0-9a-f]{40})$/m.exec(text);
  if (!header) throw new Error(`modifications: ${path.relative(root, manifestPath)} has no "# upstream <url> <commit>" header`);
  const files = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [object, mode, file] = line.split("\t");
    files.set(file, { object, mode });
  }
  return { commit: header[1], files };
}

// git's blob id of some bytes.
const blobId = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

// The tracked files of this tree, with their modes.
function trackedFiles() {
  return execFileSync("git", ["-C", root, "ls-files", "-s", "-z"], { encoding: "utf8", maxBuffer: 1 << 30 })
    .split("\0").filter(Boolean).map((line) => {
      const [meta, file] = line.split("\t");
      return { file, mode: meta.split(" ")[0] };
    })
    .filter((e) => e.file !== "MODIFICATIONS.md" && !e.file.startsWith("private/"))
    .sort((a, b) => byBytes(a.file, b.file));
}

// The export's rules for the notice.
const isTestPath = (file) => /(^|\/)(tests?|fixtures|benchmarks?)\//.test(file) || /\.test\.[a-z]+$/.test(file);
const markable = (file) => /^(packages|native|scripts|internal)\//.test(file) && !isTestPath(file) && !/\/(generated|vendor)\//.test(file);
const GENERATED_HEADER = /generated by|do not edit|@generated|this file is generated|auto-?generated/i;
const isGenerated = (file, bytes) => /\.generated\./.test(file) ||
  (!file.startsWith("scripts/") && GENERATED_HEADER.test(bytes.subarray(0, 600).toString("utf8")));
const commentFor = (file) => /\.(ts|tsx|mts|cts|js|mjs|cjs|c|h|cc|cpp|rs|zig)$/.test(file) ? `// ${NOTICE}\n`
  : /\.(sh|py|ya?ml|toml)$/.test(file) ? `# ${NOTICE}\n` : null;

// The content without its notice line (where the notice sits: first, or right after a shebang), and whether it had one.
function stripNotice(file, bytes) {
  const comment = commentFor(file);
  if (comment === null) return { bare: bytes, noticed: false };
  const text = bytes.toString("utf8");
  const shebang = text.startsWith("#!") ? text.slice(0, text.indexOf("\n") + 1) : "";
  if (!text.startsWith(comment, shebang.length)) return { bare: bytes, noticed: false };
  return { bare: Buffer.from(shebang + text.slice(shebang.length + comment.length)), noticed: true };
}

function withNotice(file, bare) {
  const text = bare.toString("utf8");
  const shebang = text.startsWith("#!") ? text.slice(0, text.indexOf("\n") + 1) : "";
  return Buffer.from(shebang + commentFor(file) + text.slice(shebang.length));
}

const upstream = readManifest();
const modified = [], added = [], noticeChanges = [];
const present = new Set();
for (const { file, mode } of trackedFiles()) {
  present.add(file);
  const full = path.join(root, file);
  const link = mode === "120000";
  const bytes = link ? Buffer.from(fs.readlinkSync(full)) : fs.readFileSync(full);
  const { bare, noticed } = link ? { bare: bytes, noticed: false } : stripNotice(file, bytes);
  const theirs = upstream.files.get(file);
  const isModified = theirs !== undefined && theirs.object !== blobId(bare);
  if (theirs === undefined) added.push(file);
  else if (isModified) modified.push(file);
  const wants = isModified && !link && markable(file) && !isGenerated(file, bare) && commentFor(file) !== null;
  if (wants !== noticed) noticeChanges.push({ file, full, next: wants ? withNotice(file, bare) : bare, wants });
}
const removed = [...upstream.files.keys()].filter((f) => !present.has(f)).sort(byBytes);

// Removed files by directory: a path's first two directory names (files at the root are one group). Groups of at
// least TABLE_MIN files get a row, largest first; the rest share one.
const TABLE_MIN = 20;
const groups = new Map();
for (const f of removed) {
  const dirs = f.split("/").slice(0, -1);
  const key = dirs.length === 0 ? "" : `${dirs.slice(0, 2).join("/")}/`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const ranked = [...groups].sort((a, b) => b[1] - a[1] || byBytes(a[0], b[0]));
const shown = ranked.filter(([key, n]) => key !== "" && n >= TABLE_MIN);
const rest = ranked.filter((g) => !shown.includes(g));

const list = (files) => files.map((f) => `- \`${f}\``);
const text = [
  "# Modifications",
  "",
  `This tree is a derivative of scriptc (${UPSTREAM_URL}), licensed under the Apache License, Version 2.0 (LICENSE). It is compared here with upstream commit \`${upstream.commit}\`. The LLVM backend (\`packages/compiler/src/backend/llvm\`), the IR (\`packages/compiler/src/ir\`), the runtime (\`packages/runtime\` and the runtime and LLVM packs) and \`native/llvm-codegen\` track upstream at that commit, with the changes listed below. The frontend (\`packages/compiler/src/frontend\`), the compiler's unit and integration tests, the test corpus and fixtures, the compatibility inventory and the documentation are this fork's own and follow an earlier upstream state, so upstream's newer tests and documentation are not included.`,
  "",
  `As section 4(b) of the license requires, the files below carry changes. ${modified.length} files are modified from that upstream commit and ${added.length} files are new; ${removed.length} upstream files are not part of this tree (see "Removed files"). Each modified source file of the compiler, the runtime and the repository tooling also says so in its first comment line.`,
  "",
  "## Modified files",
  "",
  ...list(modified),
  "",
  "## Added files",
  "",
  ...list(added),
  "",
  "## Removed files",
  "",
  `These ${removed.length} files are in upstream commit \`${upstream.commit}\` and not in this tree. Most were added upstream after the state this fork's frontend and tests follow; the rest were removed by the fork. By directory:`,
  "",
  "<table>",
  "<tr><th>Directory</th><th>Files</th></tr>",
  ...shown.map(([key, n]) => `<tr><td><code>${key}</code></td><td>${n}</td></tr>`),
  ...(rest.length > 0 ? [`<tr><td>${rest.length} other directories</td><td>${rest.reduce((s, [, n]) => s + n, 0)}</td></tr>`] : []),
  "</table>",
  "",
  "<details>",
  `<summary>All ${removed.length} removed paths</summary>`,
  "",
  ...list(removed),
  "",
  "</details>",
  "",
].join("\n");

const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
const summary = `${modified.length} modified, ${added.length} added, ${removed.length} removed against ${upstream.commit.slice(0, 12)}`;
if (check) {
  const problems = [];
  if (current !== text) problems.push("MODIFICATIONS.md is out of date");
  for (const c of noticeChanges) problems.push(`${c.file}: ${c.wants ? "modified from upstream and has no notice" : "carries a notice but is not a modified implementation source"}`);
  if (problems.length > 0) {
    for (const p of problems.slice(0, 50)) console.error(`modifications: ${p}`);
    if (problems.length > 50) console.error(`modifications: ... and ${problems.length - 50} more`);
    console.error("modifications: run `node scripts/modifications.mjs` and commit the result");
    process.exit(1);
  }
  console.log(`modifications: current (${summary})`);
} else {
  for (const c of noticeChanges) fs.writeFileSync(c.full, c.next);
  if (current !== text) fs.writeFileSync(outputPath, text);
  const addedNotices = noticeChanges.filter((c) => c.wants).length;
  console.log(`modifications: ${summary}; MODIFICATIONS.md ${current === text ? "unchanged" : "written"}, ${addedNotices} notices added, ${noticeChanges.length - addedNotices} removed`);
}
