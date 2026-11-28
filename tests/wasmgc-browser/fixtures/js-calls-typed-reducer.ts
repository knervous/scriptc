// A typed reducer stored and called by compiled JavaScript (React's useReducer path): its record arguments
// come back from the dynamic side and convert to the declared records.
import { useReducer, flush, dispatchFromJs } from "./js-calls-typed-reducer-helper.js";
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
act({ kind: "add", id: 0 });
act({ kind: "select", id: 2 });
// Through an untyped binding the action is an untyped literal, built for whichever side the callee is on.
const loose: any = dispatch;
loose({ kind: "add", id: 0 });
dispatchFromJs("select", 3);
// An action the page made.
const page: any = globalThis;
act(page.auditAction("add", 0));
loose(page.auditAction("add", 0));
const s1: State = flush();
console.log(s1.rows.length, s1.rows.map((r) => r.label).join(","), s1.selected, s1.nextId);
