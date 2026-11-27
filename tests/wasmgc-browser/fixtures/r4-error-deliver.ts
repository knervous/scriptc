// A compiled Error thrown through JavaScript and handed to a typed callback keeps its identity.
import { deliver } from './r4-typed-helper.js';
const out: string[] = [];
deliver(() => { throw new Error("boom 7"); }, (error: any, info: any) => {
  out.push((error instanceof Error ? "err " + error.message : "non-error " + typeof error) + " stack:" + typeof info.componentStack);
});
deliver(() => { throw new TypeError("bad"); }, (error: any) => { out.push(String(error instanceof TypeError) + " " + String(error instanceof Error) + " " + error.name); });
console.log(out.join(" | "));
