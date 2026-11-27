// Module functions every direct call feeds int32s or literals; namespace values, re-exports and dynamic reads reach
// them with other doubles and run-time strings.
export type Gait = "idle" | "walk" | "run";
export function half(n: number): number { return n / 2; }
export function mix(a: number, b: number): number { return (a * 31 + b) | 0; }
export function gaitSpeed(g: Gait): number { return g === "idle" ? 0 : g === "walk" ? 2 : g === "run" ? 6 : -1; }
export function nextGait(g: Gait): Gait { return g === "idle" ? "walk" : g === "walk" ? "run" : "idle"; }
export function scaleBy(n: number, k: number): number { return n * k; }
export function tagOf(g: Gait, n: number): string { return g + ":" + n; }
