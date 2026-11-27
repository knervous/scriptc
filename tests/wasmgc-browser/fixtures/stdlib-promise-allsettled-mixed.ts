// @native-only: engine-dyn emitter rejects the settled-record module (invalid module); reason crosses as a native dyn
// @options: {"interfaceClassArms": true}
// Promise.allSettled: mixed fulfilled/rejected inputs, input order, non-Error reasons,
// void promises, an empty input, and the settled record narrowed by status.
// Settle after `ticks` microtask turns, so completion order differs from input order.
async function later<T>(v: T, ticks: number): Promise<T> { for (let i = 0; i < ticks; i++) await Promise.resolve(); return v; }
async function failLater(reason: unknown, ticks: number): Promise<number> { for (let i = 0; i < ticks; i++) await Promise.resolve(); throw reason; }
async function main(): Promise<void> {
  const rs = await Promise.allSettled([later(1, 20), failLater("plain string", 5), later(3, 1), failLater(42, 10), failLater(new Error("boom"), 2)]);
  const out: string[] = [];
  for (const r of rs) {
    if (r.status === "fulfilled") out.push("ok:" + r.value);
    else out.push("no:" + (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  }
  console.log(out.join(" "));
  const objReason = await Promise.allSettled([failLater({ code: 7 }, 1)]);
  const first = objReason[0]!;
  console.log(first.status, first.status === "rejected" ? (first.reason as { code: number }).code : -1);
  const voids = await Promise.allSettled([Promise.resolve(), (async () => { throw new Error("v"); })()]);
  console.log(voids.map((r) => r.status).join(","), voids[1]!.status === "rejected" ? (voids[1]!.reason as Error).message : "");
  const none = await Promise.allSettled([] as Promise<string>[]);
  console.log(none.length);
  const all = await Promise.allSettled(new Set([later("a", 2), later("b", 1)]));
  console.log(all.map((r) => (r.status === "fulfilled" ? r.value : "x")).join(""));
}
main();
