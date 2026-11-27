// @native-only: ++/-- on a member of a value stored as dyn (the engine model refuses it at compile time)
// Increment and decrement of a member on a record the compiler keeps
// dynamic (it holds an engine-owned WeakSet): updated in place.
interface State {
  owners?: WeakSet<object>;
  bindings: number;
  aux: number;
}
const states = new Map<string, State>();
states.set("a", { bindings: 0, aux: 5 });
function bind(id: string, owner: object): number {
  const state = states.get(id);
  if (!state) return -1;
  (state.owners ??= new WeakSet()).add(owner);
  state.bindings++;
  return state.aux--;
}
const o = {};
console.log(bind("a", o), bind("a", o), bind("b", o));
const a = states.get("a")!;
console.log(a.bindings, a.aux, ++a.bindings, a.bindings, a.owners?.has(o) === true);
