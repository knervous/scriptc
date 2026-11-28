// The table of rows in the js-framework-benchmark style, on LUI (packages/lui): the same rows, labels and operations as
// the React program (../../../react-dom/app/app.ts), written as an Elm-style program. The model is immutable data, every
// button and row link sends a message, and a row's subtree is rebuilt only when its row changed (lazy), the selected row
// apart.
import { h, LazyMemory, lazy, only, program, type Next, type VElement } from "@scriptw/lui";

const ADJECTIVES = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean",
  "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy"];
const COLOURS = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const NOUNS = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse",
  "keyboard"];

interface Row {
  readonly id: number;
  readonly label: string;
}

interface Model {
  readonly rows: readonly Row[];
  readonly selected: number;
  readonly nextId: number;
  readonly seed: number;
}

/** What a button or row link asks for, and the row it names (0 for none). */
interface Msg {
  readonly kind: string;
  readonly id: number;
}

/** A small deterministic generator, so every build makes the same labels. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

function buildRows(model: Model, count: number): { rows: Row[]; nextId: number; seed: number } {
  const rows: Row[] = [];
  let seed = model.seed;
  let id = model.nextId;
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

function update(msg: Msg, model: Model): Next<Model, Msg> {
  switch (msg.kind) {
    case "run": {
      const made = buildRows(model, 1000);
      return only({ rows: made.rows, selected: 0, nextId: made.nextId, seed: made.seed });
    }
    case "runlots": {
      const made = buildRows(model, 10000);
      return only({ rows: made.rows, selected: 0, nextId: made.nextId, seed: made.seed });
    }
    case "add": {
      const made = buildRows(model, 1000);
      return only({ rows: model.rows.concat(made.rows), selected: model.selected, nextId: made.nextId, seed: made.seed });
    }
    case "update": {
      const rows = model.rows.slice();
      for (let i = 0; i < rows.length; i += 10) {
        const r = rows[i]!;
        rows[i] = { id: r.id, label: r.label + " !!!" };
      }
      return only({ rows, selected: model.selected, nextId: model.nextId, seed: model.seed });
    }
    case "clear":
      return only({ rows: [], selected: 0, nextId: model.nextId, seed: model.seed });
    case "swaprows": {
      if (model.rows.length <= 998) return only(model);
      const rows = model.rows.slice();
      const t = rows[1]!;
      rows[1] = rows[998]!;
      rows[998] = t;
      return only({ rows, selected: model.selected, nextId: model.nextId, seed: model.seed });
    }
    case "select":
      return only({ rows: model.rows, selected: msg.id, nextId: model.nextId, seed: model.seed });
    case "remove": {
      const at = model.rows.findIndex((r) => r.id === msg.id);
      if (at < 0) return only(model);
      const rows = model.rows.slice();
      rows.splice(at, 1);
      return only({ rows, selected: model.selected, nextId: model.nextId, seed: model.seed });
    }
    default:
      return only(model);
  }
}

function rowView(row: Row, selected: boolean, send: (msg: Msg) => void): VElement {
  const id = row.id;
  return h("tr", { class: selected ? "danger" : "" }, [
    h("td", { class: "col-md-1" }, id),
    h("td", { class: "col-md-4" }, [h("a", { onClick: () => send({ kind: "select", id }) }, row.label)]),
    h("td", { class: "col-md-1" }, [h("a", { onClick: () => send({ kind: "remove", id }) }, [
      h("span", { class: "glyphicon glyphicon-remove", "aria-hidden": "true" }, null)])]),
    h("td", { class: "col-md-6" }, null),
  ], id);
}

function button(id: string, title: string, msg: Msg, send: (msg: Msg) => void): VElement {
  return h("div", { class: "col-sm-6 smallpad" }, [
    h("button", { type: "button", class: "btn btn-primary btn-block", id, onClick: () => send(msg) }, title)]);
}

/** The rows' subtrees across renders: an unchanged row object is the same subtree. */
const rowMemory = new LazyMemory();

function view(model: Model, send: (msg: Msg) => void): VElement {
  const rows: VElement[] = [];
  for (const row of model.rows) {
    // The selected row is drawn fresh (its class differs); every other row is its row object's subtree.
    rows.push(row.id === model.selected ? rowView(row, true, send) : lazy(row.id, row, (r: Row) => rowView(r, false, send), rowMemory));
  }
  rowMemory.swap();
  return h("div", { class: "container" }, [
    h("div", { class: "jumbotron" }, [h("div", { class: "row" }, [
      h("div", { class: "col-md-6" }, [h("h1", null, "LUI")]),
      h("div", { class: "col-md-6" }, [h("div", { class: "row" }, [
        button("run", "Create 1,000 rows", { kind: "run", id: 0 }, send),
        button("runlots", "Create 10,000 rows", { kind: "runlots", id: 0 }, send),
        button("add", "Append 1,000 rows", { kind: "add", id: 0 }, send),
        button("update", "Update every 10th row", { kind: "update", id: 0 }, send),
        button("clear", "Clear", { kind: "clear", id: 0 }, send),
        button("swaprows", "Swap Rows", { kind: "swaprows", id: 0 }, send),
      ])]),
    ])]),
    h("table", { class: "table table-hover table-striped test-data" }, [h("tbody", null, rows)]),
    h("span", { class: "preloadicon glyphicon glyphicon-remove", "aria-hidden": "true" }, null),
  ]);
}

/** Mounts the table app into `container`. */
export function mount(container: Element): void {
  program<Model, Msg>({ init: only({ rows: [], selected: 0, nextId: 1, seed: 42 }), update, view }, container);
}

interface Count {
  readonly n: number;
}

/** One mount/update/unmount cycle of a small tree (3 when every check passed). */
export function cycle(): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let ok = 0;
  const app = program<Count, number>({
    init: only({ n: 1 }),
    update: (msg: number, _m: Count) => only({ n: msg }),
    view: (m: Count) => h("div", { class: "app" }, [h("span", null, "count " + m.n)]),
  }, container);
  if (container.textContent === "count 1") ok++;
  app.send(2);
  app.flush();
  if (container.textContent === "count 2") ok++;
  app.dispose();
  if (container.textContent === "") ok++;
  container.remove();
  return ok;
}
