// src/stream holds the DOM stream's sources for the published package: it must match packages/dom-stream and
// packages/host-stream (scripts/sync-stream.mjs rewrites it).
import { expect, test } from "vitest";
// @ts-expect-error: a plain ES module without declarations
import { stale } from "../scripts/sync-stream.mjs";

test("src/stream is a current copy of the DOM stream's sources", () => {
  expect(stale()).toEqual([]);
});
