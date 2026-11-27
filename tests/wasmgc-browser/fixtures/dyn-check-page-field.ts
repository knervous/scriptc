// @native-only: engine dyn has no dyn checker; this exercises the native one
// An `any` value checked into a record whose field is a page value (a canvas,
// a GPU handle): the field takes the page object as it is, and the record's
// other fields are checked as usual
// (the wrong-kind case is dyn-check-page-field-reject: native-any only).
interface Target { canvas: HTMLCanvasElement; scale: number; }
function adopt(value: any): Target { return value; }
const page: any = globalThis;
const canvas = page.auditCanvas(8, 6);
const t = adopt({ canvas, scale: 2 });
console.log(t.canvas.width * t.scale, t.canvas === canvas);
export {};
