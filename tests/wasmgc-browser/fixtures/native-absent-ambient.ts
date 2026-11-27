// @options: {"hostHandles": true}
// A project `declare` is not a present global either: `typeof` asks the host at runtime.
declare var __absentCtor: { new (): object };
declare function __absentFn(): number;
declare const __absentConst: number;
const out: string[] = [];
out.push([typeof __absentCtor, typeof __absentFn, typeof __absentConst].join());
out.push(typeof __absentCtor !== "undefined" ? "ctor present" : "ctor absent");
out.push(typeof __absentFn === "function" ? "fn present" : "fn absent");
out.push(typeof __absentConst === "undefined" ? "const absent" : "const present");
console.log(out.join("\n"));
