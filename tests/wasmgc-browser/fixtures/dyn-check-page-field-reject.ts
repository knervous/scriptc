// @native-any-only: a TS-any value checked into a typed record at the boundary
// @profile: checked boundary: a TS-any value of the wrong field kind under a record annotation throws a TypeError (JS keeps the value, prints "no throw"); only the native-any lane represents any as checked storage
// @expect: 16 true
// @expect: threw true
// An `any` value checked into a record whose field is a page value (a canvas,
// a GPU handle): the field takes the page object as it is, and the record's
// other fields are checked as usual.
interface Target { canvas: HTMLCanvasElement; scale: number; }
function adopt(value: any): Target { return value; }
const page: any = globalThis;
const canvas = page.auditCanvas(8, 6);
const t = adopt({ canvas, scale: 2 });
console.log(t.canvas.width * t.scale, t.canvas === canvas);
try {
  adopt({ canvas, scale: "x" });
  console.log("no throw");
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
export {};
