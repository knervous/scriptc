import type { Emitter } from "./block-a.ts";
export const emitter: Emitter = { className: "B", emit: (input) => `b:${input * 2}` };
export function helper(): number { return 7; }
