// The WasmGC build against published React (react and react-dom from npm, unmodified): the same exports as ../wasm/entry.ts.
import { mount as mountApp, cycle as runCycle } from "../app/app.ts";
export function mount(id: string): void { mountApp(document.getElementById(id)!); }
export function cycle(): number { return runCycle(); }
