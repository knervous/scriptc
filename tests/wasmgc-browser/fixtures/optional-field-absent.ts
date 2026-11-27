// @options: {"hostHandles": true}
// @native-any-only: `any` is a checked dyn value only in the native-any lane
// A component-shaped function takes its props from an untyped caller (createElement): every optional field may be absent or undefined, whatever its type.
interface Shape { x: number }
interface Props {
  a?: () => number;
  b?: Shape;
  c?: string | number;
  d?: number[];
  e?: number;
  g?: (e: MouseEvent) => void;
  h?: HTMLElement;
  j?: Shape | null;
  k?: Promise<void>;
  onHeaderMouseDown?: (event: MouseEvent) => void;
  children?: unknown;
}
function render(props: Props): string {
  return [props.a === undefined ? "-" : props.a(), props.b === undefined ? "-" : props.b.x, props.c === undefined ? "-" : props.c, props.d === undefined ? "-" : props.d.length,
    props.e === undefined ? "-" : props.e, props.g === undefined ? "-" : "g", props.h === undefined ? "-" : "h", props.j === undefined ? "u" : props.j === null ? "n" : props.j.x,
    props.k === undefined ? "-" : "k", props.onHeaderMouseDown === undefined ? "-" : "m", props.children === undefined ? "-" : "c"].join(",");
}
function createElement(type: any, props: any): string { return type(props); }
const out: string[] = [];
out.push(createElement(render, {}));
out.push(createElement(render, { a: undefined, b: undefined, c: undefined, d: undefined, e: undefined, g: undefined, h: undefined, j: undefined, k: undefined, onHeaderMouseDown: undefined, children: undefined }));
out.push(createElement(render, { a: () => 7, b: { x: 3 }, c: "s", d: [1, 2], e: 5, g: () => {}, j: null, onHeaderMouseDown: () => {}, children: 1 }));
out.push(createElement(render, { b: { x: 4 } }));
out.push(createElement(render, { j: { x: 9 }, c: 2 }));
console.log(out.join("\n"));
