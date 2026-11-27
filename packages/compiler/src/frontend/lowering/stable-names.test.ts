import { afterEach, expect, test } from "vitest";
import { keyHash, setStableNameFiles, stableFileName } from "./stable-names.js";

afterEach(() => setStableNameFiles([]));

const checkout = (root: string) => [
  `${root}/client/.wasmgc-entry4211/src/main.ts`,
  `${root}/client/.wasmgc-entry4211/src/render/world.ts`,
  `${root}/vendor/lite/src/scene.ts`,
  "/Users/someone/elsewhere/client/node_modules/pkg/index.d.ts",
];

test("a key names the program's files relative to its checkout, so two checkouts agree", () => {
  const key = (root: string) => {
    setStableNameFiles(checkout(root));
    return stableFileName(`r|${root}/vendor/lite/src/scene.ts:10:20|${root}/client/.wasmgc-entry99/src/main.ts`);
  };
  const one = key("/Users/a/source/tree");
  const two = key("/private/tmp/x/scratchpad/worktree");
  expect(one).toBe("r|vendor/lite/src/scene.ts:10:20|client/.wasmgc/src/main.ts");
  expect(two).toBe(one);
  expect(keyHash(two)).toBe(keyHash(one));
});

test("a package is named by its path under node_modules, wherever that directory is", () => {
  setStableNameFiles(checkout("/Users/a/source/tree"));
  expect(stableFileName("/Users/someone/elsewhere/client/node_modules/@scope/pkg/dist/a.d.ts:4"))
    .toBe("node_modules/@scope/pkg/dist/a.d.ts:4");
});

test("without program files a key keeps its paths, minus the build's private mirror", () => {
  expect(stableFileName("/a/b/client/.wasmgc-entry12/src/x.ts")).toBe("/a/b/client/.wasmgc/src/x.ts");
});
