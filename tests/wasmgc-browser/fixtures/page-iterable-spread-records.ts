// @options: {"interfaceClassArms": true}
// Spreading a page array of records / unions / arrays (React state read through
// the page: `[state.position, ...state.path.slice(i)]`) into a typed array
// literal: each element validates against the element type as it lands.
interface Pt { x: number; y: number }
const h: any = globalThis;
const state: any = h.auditIdentity({ position: { x: 0, y: 0 }, path: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], ids: [["a"], ["b", "c"]], mixed: [1, "two", null] });
const pts: Pt[] = [state.position, ...state.path.slice(1)];
console.log(pts.length, pts.map((p) => p.x + p.y).join());
const ids: string[][] = [...state.ids];
console.log(ids.length, ids[1]![1]);
const mixed: (number | string | null)[] = [...state.mixed];
console.log(mixed.map((m) => typeof m).join());
const none: Pt[] = [...(state.absent ?? [])];
console.log(none.length);
