// The WasmGC build's entry: the page calls setup, waits for ready() (a module exports synchronous functions only, and
// the Babylon Lite engine starts asynchronously), then calls frame.
import { frame as runFrame, setup as runSetup } from "./app.ts";
let done = 0;
export function setup(id: string, n: number): void {
  runSetup(document.getElementById(id) as HTMLCanvasElement, n).then(() => { done = 1; }, (e: unknown) => { console.error(String(e)); done = -1; });
}
export function ready(): number { return done; }
export function frame(t: number): number { return runFrame(t); }
