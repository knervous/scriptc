// @options: {"hostHandles": true}
// A lib-declared global is not a present one: `typeof` and presence tests ask the host at runtime. The native host has no MessageChannel, setImmediate,
// requestIdleCallback or AbortController; an absent global is undefined, and a guard around it must take the other branch.
const out: string[] = [];
const make = typeof MessageChannel !== "undefined" ? () => new MessageChannel() : () => null;
const channel = make();
out.push(channel === null ? "ok" : "ok");
const schedule = typeof setImmediate === "function" ? (f: () => void) => { setImmediate(f); } : (f: () => void) => { setTimeout(f, 0); };
schedule(() => out.push("scheduled"));
const idle = typeof requestIdleCallback === "function" ? (f: () => void) => { requestIdleCallback(f); } : (f: () => void) => { setTimeout(f, 0); };
idle(() => out.push("idle"));
const abort = typeof AbortController !== "undefined" ? () => new AbortController() : () => null;
abort();
setTimeout(() => { console.log(out.slice().sort().join("\n")); }, 20);
