// The WasmGC build's entry: the same exports the JavaScript build's entry makes (../app/js-entry.ts).
import { mount as mountApp, cycle as runCycle } from "../app/app.ts";
export function mount(id: string): void { mountApp(document.getElementById(id)!); }
export function cycle(): number { return runCycle(); }
