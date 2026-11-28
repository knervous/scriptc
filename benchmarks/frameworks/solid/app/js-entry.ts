// The JavaScript build's entry: the same exports the WasmGC build's entry makes.
import { cycle as runCycle, mount as mountApp } from "./app.tsx";
export function mount(id: string): void { mountApp(document.getElementById(id)!); }
export function cycle(): number { return runCycle(); }
