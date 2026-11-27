// Pins a known defect's expected failure to a signature, so that an unrelated
// failure (a compiler crash, another runtime error, an output regression)
// cannot satisfy a `// @known-defect` marker. Pure: no compiler, no I/O.
//
//   // @known-defect-expect: compile: <diagnostic substring>
//   // @known-defect-expect: run: <outcome> <error substring>
//   // @known-defect-expect: stdout: <substring of the wrong output>
//
// `outcome` is an exact gate outcome (exit:1, signal:SIGABRT, timeout, ...).

/** Parses the `@known-defect-expect` directive; null when absent. */
export function parseKnownDefectExpect(src) {
  const raw = /^\/\/ @known-defect-expect: (.+)$/m.exec(src)?.[1]?.trim();
  if (raw === undefined) return null;
  const compile = /^compile: (.+)$/.exec(raw);
  if (compile) return { phase: "compile", text: compile[1].trim() };
  const stdout = /^stdout: (.+)$/.exec(raw);
  if (stdout) return { phase: "stdout", text: stdout[1].trim() };
  const run = /^run: (\S+) (.+)$/.exec(raw);
  if (run) return { phase: "run", outcome: run[1], text: run[2].trim() };
  return { phase: "invalid", raw };
}

const describe = (b) => {
  if (b.crashed) return `compiler crash (${(b.diagnostics ?? []).join(" | ")})`;
  if (b.compiled === false) return `compile failed: ${(b.diagnostics ?? []).join(" | ") || "no diagnostic"}`;
  if (b.compiled === true) return `ran to ${b.outcome}, stdout ${JSON.stringify(b.stdout)}, error ${JSON.stringify(b.error ?? "")}`;
  return "no result";
};

/**
 * Judges every build of a known-defect fixture against its signature. Each
 * build must FAIL and fail exactly as the signature says.
 * @returns {{ ok: boolean, why?: string }}
 */
export function judgeKnownDefect(builds, signature) {
  if (!signature) return { ok: false, why: "known defect: no @known-defect-expect signature" };
  if (signature.phase === "invalid") return { ok: false, why: `malformed @known-defect-expect: ${signature.raw}` };
  if (!builds.length) return { ok: false, why: "known defect: no builds to judge" };
  for (const b of builds) {
    const at = `[${b.mode}]`;
    if (b.ok === true) return { ok: false, why: `unexpected pass: known defect no longer reproduces ${at}: remove its @known-defect directive` };
    const differently = `known defect failed differently ${at}: ${describe(b)}`;
    if (signature.phase === "compile") {
      if (b.crashed || b.compiled !== false) return { ok: false, why: `${differently} (want compile diagnostic containing ${JSON.stringify(signature.text)})` };
      if (!(b.diagnostics ?? []).some((d) => d.includes(signature.text))) return { ok: false, why: `${differently} (want diagnostic containing ${JSON.stringify(signature.text)})` };
    } else if (signature.phase === "stdout") {
      // A wrong-output defect: it runs to exit:0 and prints the pinned wrong text.
      if (b.crashed || b.compiled !== true || b.outcome !== "exit:0") return { ok: false, why: `${differently} (want exit:0 with stdout containing ${JSON.stringify(signature.text)})` };
      if (!(b.stdout ?? "").includes(signature.text)) return { ok: false, why: `${differently} (want stdout containing ${JSON.stringify(signature.text)})` };
    } else {
      if (b.crashed || b.compiled !== true) return { ok: false, why: `${differently} (want run ${signature.outcome}, error containing ${JSON.stringify(signature.text)})` };
      if (b.outcome !== signature.outcome) return { ok: false, why: `${differently} (want outcome ${signature.outcome})` };
      if (!(b.error ?? "").includes(signature.text)) return { ok: false, why: `${differently} (want error containing ${JSON.stringify(signature.text)})` };
    }
  }
  return { ok: true };
}
