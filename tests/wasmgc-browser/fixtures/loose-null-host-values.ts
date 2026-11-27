// @native-any-only: `== null` / `!= null` on host (page) values: a host object that exists, one that is null, one that is undefined.
let present: AbortSignal | null = new AbortController().signal;
let absent: AbortSignal | null = null;
let missing: AbortSignal | undefined;
const checks: string[] = [];
checks.push(String(present == null), String(present != null), String(absent == null), String(absent != null), String(missing == null), String(missing != null));
let guard: AbortController | null = new AbortController();
let hops = 0;
for (; guard != null; guard = hops++ < 2 ? new AbortController() : null) checks.push("hop");
console.log(checks.join(","), hops);
