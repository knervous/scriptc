// The table of rows in the js-framework-benchmark style, on SolidJS: the same rows, labels and operations as the React
// program (../../../react-dom/app/app.ts), written the way Solid is written. Each row's label is its own signal, the
// selection is a selector, and the page drives it by clicking the buttons and row links (Solid's delegated events).
import { createSelector, createSignal, For, type Accessor, type Setter } from "solid-js";
import { render, type MountableElement } from "solid-js/web";

const ADJECTIVES = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean",
  "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy"];
const COLOURS = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const NOUNS = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse",
  "keyboard"];

interface Row {
  id: number;
  label: Accessor<string>;
  setLabel: Setter<string>;
}

/** A small deterministic generator, so every build makes the same labels. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

let seed = 42;
let nextId = 1;

function buildRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    seed = nextSeed(seed);
    const a = ADJECTIVES[seed % ADJECTIVES.length]!;
    seed = nextSeed(seed);
    const c = COLOURS[seed % COLOURS.length]!;
    seed = nextSeed(seed);
    const n = NOUNS[seed % NOUNS.length]!;
    const [label, setLabel] = createSignal(a + " " + c + " " + n);
    rows.push({ id: nextId++, label, setLabel });
  }
  return rows;
}

function Button(props: { id: string; title: string; onClick: () => void }) {
  return (
    <div class="col-sm-6 smallpad">
      <button type="button" class="btn btn-primary btn-block" id={props.id} onClick={props.onClick}>{props.title}</button>
    </div>
  );
}

function Main() {
  const [rows, setRows] = createSignal<Row[]>([]);
  const [selected, setSelected] = createSignal(0);
  const isSelected = createSelector(selected);

  const run = () => { setRows(buildRows(1000)); setSelected(0); };
  const runLots = () => { setRows(buildRows(10000)); setSelected(0); };
  const add = () => setRows(rows().concat(buildRows(1000)));
  const update = () => {
    const list = rows();
    for (let i = 0; i < list.length; i += 10) {
      const r = list[i]!;
      r.setLabel(r.label() + " !!!");
    }
  };
  const clear = () => { setRows([]); setSelected(0); };
  const swapRows = () => {
    const list = rows();
    if (list.length <= 998) return;
    const next = list.slice();
    const t = next[1]!;
    next[1] = next[998]!;
    next[998] = t;
    setRows(next);
  };
  const remove = (id: number) => {
    const list = rows();
    const at = list.findIndex((r) => r.id === id);
    if (at < 0) return;
    const next = list.slice();
    next.splice(at, 1);
    setRows(next);
  };

  return (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Solid</h1></div>
          <div class="col-md-6">
            <div class="row">
              <Button id="run" title="Create 1,000 rows" onClick={run} />
              <Button id="runlots" title="Create 10,000 rows" onClick={runLots} />
              <Button id="add" title="Append 1,000 rows" onClick={add} />
              <Button id="update" title="Update every 10th row" onClick={update} />
              <Button id="clear" title="Clear" onClick={clear} />
              <Button id="swaprows" title="Swap Rows" onClick={swapRows} />
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <For each={rows()}>
            {(row: Row) => {
              const id = row.id;
              return (
                <tr class={isSelected(id) ? "danger" : ""}>
                  <td class="col-md-1">{id}</td>
                  <td class="col-md-4"><a onClick={() => setSelected(id)}>{row.label()}</a></td>
                  <td class="col-md-1"><a onClick={() => remove(id)}><span class="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
                  <td class="col-md-6" />
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}

/** Mounts the table app into `container`. */
export function mount(container: MountableElement): void {
  render(() => <Main />, container);
}

/** Solid passes a reactive prop as a getter (`n={n()}` is `get n() { return n(); }`), so the props type says so. */
function Label(props: { get n(): number }) {
  return <div class="app"><span>{"count " + props.n}</span></div>;
}

/** One mount/update/unmount cycle of a small tree (3 when every check passed). */
export function cycle(): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const [n, setN] = createSignal(1);
  let ok = 0;
  const dispose = render(() => <Label n={n()} />, container);
  if (container.textContent === "count 1") ok++;
  setN(2);
  if (container.textContent === "count 2") ok++;
  dispose();
  if (container.textContent === "") ok++;
  container.remove();
  return ok;
}
