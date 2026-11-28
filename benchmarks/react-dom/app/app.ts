// A table of rows in the js-framework-benchmark style, written once and built two ways: as JavaScript against
// published React, and compiled to WasmGC. The page drives it by clicking its buttons, as a person would; the
// operations are React state updates reached through React's own event delegation.
import { createElement as h, memo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const ADJECTIVES = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean",
  "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy"];
const COLOURS = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const NOUNS = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse",
  "keyboard"];

interface Row {
  id: number;
  label: string;
}

interface State {
  rows: Row[];
  selected: number;
  nextId: number;
  seed: number;
}

/** A small deterministic generator, so both builds make the same labels. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

function buildRows(state: State, count: number): { rows: Row[]; nextId: number; seed: number } {
  const rows: Row[] = [];
  let seed = state.seed;
  let id = state.nextId;
  for (let i = 0; i < count; i++) {
    seed = nextSeed(seed);
    const a = ADJECTIVES[seed % ADJECTIVES.length]!;
    seed = nextSeed(seed);
    const c = COLOURS[seed % COLOURS.length]!;
    seed = nextSeed(seed);
    const n = NOUNS[seed % NOUNS.length]!;
    rows.push({ id, label: a + " " + c + " " + n });
    id++;
  }
  return { rows, nextId: id, seed };
}

/** An action: what the reducer does, and the row it names (0 for none). */
interface Action {
  kind: string;
  id: number;
}

function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "run": {
      const made = buildRows(state, 1000);
      return { rows: made.rows, selected: 0, nextId: made.nextId, seed: made.seed };
    }
    case "runlots": {
      const made = buildRows(state, 10000);
      return { rows: made.rows, selected: 0, nextId: made.nextId, seed: made.seed };
    }
    case "add": {
      const made = buildRows(state, 1000);
      return { rows: state.rows.concat(made.rows), selected: state.selected, nextId: made.nextId, seed: made.seed };
    }
    case "update": {
      const rows = state.rows.slice();
      for (let i = 0; i < rows.length; i += 10) {
        const r = rows[i]!;
        rows[i] = { id: r.id, label: r.label + " !!!" };
      }
      return { rows, selected: state.selected, nextId: state.nextId, seed: state.seed };
    }
    case "clear":
      return { rows: [], selected: 0, nextId: state.nextId, seed: state.seed };
    case "swaprows": {
      if (state.rows.length <= 998) return state;
      const rows = state.rows.slice();
      const t = rows[1]!;
      rows[1] = rows[998]!;
      rows[998] = t;
      return { rows, selected: state.selected, nextId: state.nextId, seed: state.seed };
    }
    case "select":
      return { rows: state.rows, selected: action.id, nextId: state.nextId, seed: state.seed };
    case "remove": {
      const at = state.rows.findIndex((r) => r.id === action.id);
      if (at < 0) return state;
      const rows = state.rows.slice();
      rows.splice(at, 1);
      return { rows, selected: state.selected, nextId: state.nextId, seed: state.seed };
    }
    default:
      return state;
  }
}

interface RowProps {
  row: Row;
  selected: boolean;
  dispatch: (action: Action) => void;
}

function RowView(props: RowProps) {
  const row = props.row;
  const dispatch = props.dispatch;
  return h("tr", { className: props.selected ? "danger" : "" },
    h("td", { className: "col-md-1" }, row.id),
    h("td", { className: "col-md-4" },
      h("a", { onClick: () => dispatch({ kind: "select", id: row.id }) }, row.label)),
    h("td", { className: "col-md-1" },
      h("a", { onClick: () => dispatch({ kind: "remove", id: row.id }) },
        h("span", { className: "glyphicon glyphicon-remove", "aria-hidden": "true" }))),
    h("td", { className: "col-md-6" }));
}

const MemoRow = memo(RowView);

function Button(props: { id: string; title: string; onClick: () => void }) {
  return h("div", { className: "col-sm-6 smallpad" },
    h("button", { type: "button", className: "btn btn-primary btn-block", id: props.id, onClick: props.onClick }, props.title));
}

function Main() {
  const [state, dispatch] = useReducer(reduce, { rows: [], selected: 0, nextId: 1, seed: 42 });
  const act = dispatch;
  const rows = state.rows;
  const children: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    children.push(h(MemoRow, { key: row.id, row, selected: row.id === state.selected, dispatch: act }));
  }
  return h("div", { className: "container" },
    h("div", { className: "jumbotron" },
      h("div", { className: "row" },
        h("div", { className: "col-md-6" }, h("h1", null, "React")),
        h("div", { className: "col-md-6" },
          h("div", { className: "row" },
            h(Button, { id: "run", title: "Create 1,000 rows", onClick: () => act({ kind: "run", id: 0 }) }),
            h(Button, { id: "runlots", title: "Create 10,000 rows", onClick: () => act({ kind: "runlots", id: 0 }) }),
            h(Button, { id: "add", title: "Append 1,000 rows", onClick: () => act({ kind: "add", id: 0 }) }),
            h(Button, { id: "update", title: "Update every 10th row", onClick: () => act({ kind: "update", id: 0 }) }),
            h(Button, { id: "clear", title: "Clear", onClick: () => act({ kind: "clear", id: 0 }) }),
            h(Button, { id: "swaprows", title: "Swap Rows", onClick: () => act({ kind: "swaprows", id: 0 }) }))))),
    h("table", { className: "table table-hover table-striped test-data" }, h("tbody", null, ...children)),
    h("span", { className: "preloadicon glyphicon glyphicon-remove", "aria-hidden": "true" }));
}

/** Mounts the table app into `container`. */
export function mount(container: HTMLElement): void {
  const root = createRoot(container);
  flushSync(() => root.render(h(Main, null)));
}

function Label(props: { n: number }) {
  return h("div", { className: "app" }, h("span", null, "count " + props.n));
}

/** One mount/update/unmount cycle of a small tree (3 when every check passed). */
export function cycle(): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let ok = 0;
  flushSync(() => root.render(h(Label, { n: 1 })));
  if (container.textContent === "count 1") ok++;
  flushSync(() => root.render(h(Label, { n: 2 })));
  if (container.textContent === "count 2") ok++;
  flushSync(() => root.unmount());
  if (container.textContent === "") ok++;
  container.remove();
  return ok;
}
