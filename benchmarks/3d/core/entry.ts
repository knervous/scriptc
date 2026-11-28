// The WasmGC build's entry: the page calls setup and frame.
import { frame as runFrame, setup as runSetup } from "./app.ts";
export function setup(id: string, n: number): void { runSetup(document.getElementById(id) as HTMLCanvasElement, n); }
export function frame(t: number): number { return runFrame(t); }
