// The runtime's contract, checked in headless Chromium: test/scenarios.ts is bundled with the runtime (its page DOM) and
// each scenario runs in a fresh page.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
// Playwright as the environment provides it, not a dependency of this package.
const { chromium } = require("playwright");

let browser: { newPage(): Promise<any>; close(): Promise<void> };
let bundle = "";

beforeAll(async () => {
  const out = await esbuild.build({
    entryPoints: [path.join(here, "scenarios.ts")], bundle: true, write: false, format: "iife", globalName: "Lui",
    platform: "browser", logLevel: "silent", absWorkingDir: path.join(here, ".."),
    // The TypeScript sources (`wasmgc`), not the built dist/ the default condition names.
    conditions: ["wasmgc"],
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
});

async function run(name: string): Promise<any> {
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: bundle });
    return await page.evaluate((scenario: string) => (globalThis as any).Lui.run(scenario), name);
  } finally {
    await page.close();
  }
}

describe("embedded and adopting programs", () => {
  test("attach() disposes the instance it started", async () => {
    expect(await run("attachDisposesItsOwn")).toEqual({ afterFirst: [1], afterBoth: [1, 2] });
  });
  test("an adopted root goes back without the program's listeners, attributes and children", async () => {
    expect(await run("adoptedRootCleanup")).toEqual({ before: 1, after: 1, children: 0, className: "" });
  });
});

describe("DOM timing", () => {
  test("onMount runs with the element in the document", async () => {
    expect(await run("mountTiming")).toEqual({ connected: true, focused: true });
  });
  test("onMount runs once for an element a patch creates", async () => {
    expect(await run("mountOnPatch")).toEqual({ mounts: 1 });
  });
  test("an afterCommit command sees the DOM its update asked for; a plain command runs before the patch", async () => {
    expect(await run("afterCommitOrder")).toEqual({ early: false, late: true });
  });
  test("several sends in one task make one view", async () => {
    expect(await run("microtaskBatching")).toEqual({ before: 1, after: 2, model: 3 });
  });
  test("flushSync patches only the programs with pending messages", async () => {
    expect(await run("flushOnlyDirty")).toEqual({ a: 2, b: 1 });
  });
});

describe("commands and subscriptions", () => {
  test("a command's scoped cleanup runs on dispose", async () => {
    expect(await run("commandCleanup")).toEqual({ fired: 0, cleaned: 1 });
  });
  test("delay delivers and forgets fired timers", async () => {
    expect(await run("delayCommand")).toEqual({ seen: ["a", "b"], scopeSize: 0 });
  });
  test("a subscription's key is its identity", async () => {
    expect(await run("subscriptionKeyIdentity")).toEqual({ starts: 1, seen: ["first"] });
  });
  test("a key used twice in one list warns and runs once", async () => {
    expect(await run("subscriptionDuplicateKey")).toEqual({ starts: 1, warned: true });
  });
});

describe("the patcher", () => {
  test("keyed lists keep order and element identity under random inserts, removals, moves and tag changes", async () => {
    expect(await run("keyedFuzz")).toEqual({ failures: [], steps: 800 });
  });
  test("static rendering orders attributes, escapes text and unwraps contents()", async () => {
    expect(await run("staticRender")).toBe('<div class="a" aria-label="x&lt;y"><img src="/i.png" alt="">a &amp; b<i>c</i></div>');
  });
  test("a promised URL lands when it resolves, a superseded one never does, and a failure fires the element's error", async () => {
    expect(await run("urlResolver")).toEqual({ plain: "/plain.png", before: null, resolved: "#a", latest: "#c", errors: 1 });
  });
});
