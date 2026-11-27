// @native-any-only: an ArrayBuffer held by `any` is the raw $Bytes (engine dyn has no page form for a compiled buffer; plain native `any` is a page value)
function describe(tag: string, x: any): void {
  console.log(tag, ArrayBuffer.isView(x), x.byteLength, x.length === undefined, x instanceof ArrayBuffer, x instanceof Uint8Array);
}
const dst = new Uint8Array([9, 9, 9, 9, 9, 9]);
const buf = new ArrayBuffer(4);
const viaInit: any = buf;
describe("init", viaInit);
let viaAssign: any = 0;
viaAssign = buf;
describe("assign", viaAssign);
function ret(): any { return buf; }
describe("return", ret());
const rec: { b: any } = { b: buf };
describe("field", rec.b);
const arr: any[] = [buf];
describe("elem", arr[0]);
describe("arg", buf);
dst.set(viaInit, 1);
dst.set(viaAssign, 1);
dst.set(ret(), 1);
console.log(Array.from(dst).join());
const u8 = new Uint8Array([1, 2, 3]);
const fromView: any = u8.buffer;
describe("viewbuf", fromView);
const direct: any = new ArrayBuffer(2);
describe("fresh", direct);
