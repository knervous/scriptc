// Symbol.toPrimitive on compiled objects: called with the hint each conversion asks for.
export function make() { return { [Symbol.toPrimitive](hint) { return "prim:" + hint; } }; }
function any(x) { return x; }
function attempt(f) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TE" : "other"; } }
export function run(o) {
  const num = any({ [Symbol.toPrimitive](hint) { return hint === "number" ? 42 : hint === "string" ? "str" : "dflt"; }, valueOf() { return 1; } });
  const plain = any({ valueOf() { return 7; }, toString() { return "seven"; } });
  const notFn = any({ [Symbol.toPrimitive]: 5 });
  const objResult = any({ [Symbol.toPrimitive]() { return {}; } });
  const undef = any({ [Symbol.toPrimitive]: undefined, valueOf() { return 3; } });
  return [
    "a" + o, `${o}`, String(o),
    num + 1, `${num}`, +num, num * 2, num < 50,
    plain + 1, `${plain}`, +plain,
    attempt(() => "x" + notFn), attempt(() => +objResult), undef + 1,
  ].join(" ");
}
