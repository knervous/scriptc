import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeKnownDefect, parseKnownDefectExpect } from "./known-defect.mjs";

const compileFail = (diagnostics, extra = {}) => ({ mode: "dev", compiled: false, diagnostics, ok: false, ...extra });
const runFail = (outcome, error, stdout = "", mode = "dev") => ({ mode, compiled: true, outcome, error, stdout, ok: false });
const runPass = (stdout = "x\n") => ({ mode: "dev", compiled: true, outcome: "exit:0", error: "", stdout, ok: true });
const compileSig = { phase: "compile", text: "dynCheck to a tuple record" };
const runSig = { phase: "run", outcome: "exit:1", text: "TypeError: value from JavaScript is not the expected compiled object" };

test("matching compile signature is ok", () => {
  const v = judgeKnownDefect([compileFail(["error TS1: dynCheck to a tuple record is unsupported"])], compileSig);
  assert.deepEqual(v, { ok: true });
});

test("matching run signature is ok", () => {
  const v = judgeKnownDefect([runFail("exit:1", "TypeError: value from JavaScript is not the expected compiled object")], runSig);
  assert.deepEqual(v, { ok: true });
});

test("every mode must match: one matching build and one pass is not ok", () => {
  const v = judgeKnownDefect([runFail("exit:1", runSig.text), runPass()], runSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /unexpected pass/);
});

test("unexpected pass is not ok", () => {
  const v = judgeKnownDefect([runPass()], runSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /^unexpected pass: known defect no longer reproduces/);
});

test("compiler crash is not ok even when its text matches the compile signature", () => {
  const crash = compileFail(["compiler crash: dynCheck to a tuple record"], { crashed: true });
  const v = judgeKnownDefect([crash], compileSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /failed differently/);
  assert.match(v.why, /compiler crash/);
});

test("compile failure with a different diagnostic is not ok", () => {
  const v = judgeKnownDefect([compileFail(["error TS1: something else entirely"])], compileSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /failed differently/);
});

test("different runtime error is not ok", () => {
  const v = judgeKnownDefect([runFail("exit:1", "RangeError: Maximum call stack size exceeded")], runSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /failed differently/);
  assert.match(v.why, /RangeError/);
});

test("different outcome (exit:0 with wrong stdout) is not ok", () => {
  const v = judgeKnownDefect([{ mode: "dev", compiled: true, outcome: "exit:0", error: "", stdout: "wrong\n", ok: false }], runSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /want outcome exit:1/);
});

test("compile failure when a run is expected is not ok", () => {
  const v = judgeKnownDefect([compileFail(["error TS1: dynCheck to a tuple record"])], runSig);
  assert.equal(v.ok, false);
  assert.match(v.why, /compile failed/);
});

test("parses the compile directive", () => {
  assert.deepEqual(parseKnownDefectExpect("// @known-defect(engine): x\n// @known-defect-expect: compile: dynCheck to a tuple record\n"), compileSig);
});

test("parses the run directive", () => {
  const src = "// @known-defect-expect: run: exit:1 TypeError: value from JavaScript is not the expected compiled object\n";
  assert.deepEqual(parseKnownDefectExpect(src), runSig);
});

test("absent directive parses to null", () => {
  assert.equal(parseKnownDefectExpect("// @known-defect(engine): legacy\nconsole.log(1);\n"), null);
});

test("malformed directive is judged not ok", () => {
  const sig = parseKnownDefectExpect("// @known-defect-expect: run: exit:1\n");
  assert.equal(sig.phase, "invalid");
  assert.equal(judgeKnownDefect([runFail("exit:1", "x")], sig).ok, false);
});

test("stdout signature: matching wrong output is ok, other output or a failure is not", () => {
  const sig = parseKnownDefectExpect("// @known-defect-expect: stdout: in:false/false keys:scale\n");
  assert.deepEqual(sig, { phase: "stdout", text: "in:false/false keys:scale" });
  const wrong = { mode: "dev", compiled: true, ok: false, outcome: "exit:0", stdout: "explicit in:false/false keys:scale,visible\n", error: "" };
  assert.equal(judgeKnownDefect([wrong, { ...wrong, mode: "release" }], sig).ok, true);
  assert.equal(judgeKnownDefect([{ ...wrong, stdout: "something else\n" }], sig).ok, false);
  assert.equal(judgeKnownDefect([{ ...wrong, outcome: "exit:1", error: "TypeError" }], sig).ok, false);
  assert.equal(judgeKnownDefect([{ ...wrong, ok: true }], sig).ok, false);
});
