// A page object converted to a typed record whose string field is stored interned (an atom: a field only ever
// written with literal strings): useReducer's shape, with typed actions first and then one the page made.
import { useReducer, flush } from "./page-object-atom-record-helper.js";
interface Row { id: number; label: string }
interface State { rows: Row[]; selected: number; nextId: number }
interface Action { kind: string; id: number }
function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "add": return { rows: [...state.rows, { id: state.nextId, label: "row " + state.nextId }], selected: state.selected, nextId: state.nextId + 1 };
    case "select": return { rows: state.rows, selected: action.id, nextId: state.nextId };
    default: return state;
  }
}
const [s0, dispatch] = useReducer(reduce, { rows: [], selected: 0, nextId: 1 });
console.log(s0.rows.length, s0.nextId);
const act: (a: Action) => void = dispatch;
act({ kind: "add", id: 0 });
const page: any = globalThis;
const loose: any = dispatch;
loose(page.auditAction("add", 0));
const s1: State = flush();
console.log(s1.rows.length, s1.rows.map((r) => r.label).join(","), s1.selected, s1.nextId);
