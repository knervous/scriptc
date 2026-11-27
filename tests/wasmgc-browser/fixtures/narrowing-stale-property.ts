class Box {
  cb: (() => number) | undefined = undefined;
  name: string | undefined = "x";
  clear(): void { this.cb = undefined; this.name = undefined; }
}
const b = new Box();
b.cb = () => { b.clear(); return 1; };
console.log(b.cb?.());
console.log(b.cb?.());
const b2 = new Box();
b2.name = "hello";
function wipe(x: Box): void { x.name = undefined; }
if (b2.name !== undefined) {
  wipe(b2);
  console.log(b2.name === undefined, typeof b2.name);
  try { console.log(b2.name.length); } catch (e) { console.log("threw", (e as Error).message); }
}
const b3 = new Box();
b3.cb = () => { b3.cb = undefined; return 2; };
console.log(b3.cb());
try { console.log(b3.cb()); } catch (e) { console.log("threw", (e as Error).message); }
