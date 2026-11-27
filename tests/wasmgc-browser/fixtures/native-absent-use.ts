// @options: {"hostHandles": true}
// @native-only: the engine lane has the page's own messages
// @profile: an absent global is undefined to the host (and the page), so constructing / calling it is a TypeError; Node's free reference to an undeclared name is a ReferenceError
// @expect: new: TypeError IdleDeadline is not a constructor
// @expect: call: TypeError requestIdleCallback is not a function
// @expect: new args: TypeError ResizeObserverSize is not a constructor
// @expect: optional: undefined
// @expect: nullish: dflt
// @expect: nullish chain: dflt
// @expect: default param: dflt
// @expect: member new: TypeError value is not a constructor
// @expect: member call: TypeError g.NoSuchGlobal is not a function
// @expect: truthy: absent
// @expect: eq undefined: true
// @expect: eq null: false
function attempt(label: string, f: () => unknown): void {
  try { f(); console.log(label + ": ok"); } catch (e) { console.log(label + ": " + (e instanceof TypeError ? "TypeError " + (e as Error).message : e instanceof ReferenceError ? "ReferenceError" : "other")); }
}
attempt("new", () => new IdleDeadline());
attempt("call", () => requestIdleCallback(() => 0));
attempt("new args", () => new ResizeObserverSize());
const g = globalThis as any;
console.log("optional: " + String(g.NoSuchGlobal?.value));
console.log("nullish: " + (g.NoSuchGlobal ?? "dflt"));
console.log("nullish chain: " + (g.NoSuchGlobal?.value ?? "dflt"));
function withDefault(x: any = "dflt") { return x; }
console.log("default param: " + withDefault(g.NoSuchGlobal));
attempt("member new", () => new g.NoSuchGlobal());
attempt("member call", () => g.NoSuchGlobal());
console.log("truthy: " + (g.NoSuchGlobal ? "present" : "absent"));
console.log("eq undefined: " + String(g.NoSuchGlobal === undefined));
console.log("eq null: " + String(g.NoSuchGlobal === null));
