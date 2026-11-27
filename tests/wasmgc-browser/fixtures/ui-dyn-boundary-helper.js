// Untyped side of ui-dyn-boundary.ts. Untyped parameters are dyn values, as
// in a compiled package's code (React's `const [state, setState] = useState()`).
let kept;
export function keep(value) { kept = value; }
export function back() { return kept; }
function three(v) { const [a, b, c] = v; return `${a},${b},${c}`; }
function firstAndThird(v) { const [x, , z] = v; return `${x}${z}`; }
function two(v) { const [first, second] = v; return [first, second]; }
function one(v) { const [n] = v; return String(n); }
function counting() {
  const state = { i: 0, closed: 0 };
  state.iterable = { [Symbol.iterator]: () => ({ next: () => ({ value: ++state.i, done: state.i > 3 }), return: () => { state.closed++; return { value: undefined, done: true }; } }) };
  return state;
}
export function destructure() {
  const out = [three([1, 2]), firstAndThird("héllo")];
  const c = counting();
  const [first, second] = two(c.iterable);
  out.push(`${first},${second},closed=${c.closed}`);
  const [get, state] = two([() => 7, "state"]);
  out.push(`${get()},${state}`);
  try { out.push(one({})); } catch (e) { out.push(`${e.constructor.name}: ${e.message}`); }
  return out.join(" | ");
}
export function pageWithAccessor() {
  const t = new EventTarget();
  let stored = "";
  Object.defineProperty(t, "value", { configurable: true, get() { return `[${stored}]`; }, set(v) { stored = String(v); } });
  t.value = "abc";
  return t.value;
}
