// The table's state on Svelte 5 runes: the same rows, labels and operations as the React program
// (../../../react-dom/app/app.ts). Each row's label is its own piece of state, so updating a label touches its row alone.
const ADJECTIVES = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean",
  "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy"];
const COLOURS = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const NOUNS = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse",
  "keyboard"];

export class Row {
  id: number;
  label: string = $state("");
  constructor(id: number, label: string) {
    this.id = id;
    this.label = label;
  }
}

/** A small deterministic generator, so every build makes the same labels. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

let seed = 42;
let nextId = 1;

export function buildRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    seed = nextSeed(seed);
    const a = ADJECTIVES[seed % ADJECTIVES.length]!;
    seed = nextSeed(seed);
    const c = COLOURS[seed % COLOURS.length]!;
    seed = nextSeed(seed);
    const n = NOUNS[seed % NOUNS.length]!;
    rows.push(new Row(nextId++, a + " " + c + " " + n));
  }
  return rows;
}
