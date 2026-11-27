// @native-any-only: untyped writes through an any-typed binding into compiled class fields; the engine model keeps its fences
import { selfAssign, copyMaterial, setDevice, setChildren, setOrtho, callBack, passThrough } from "./dyn-ref-writes-helper.js";
interface Mat { name: string; shade(): string; peers(p: Promise<Mat[]>): Promise<Mat | undefined> }
interface Kid { id: number; describe(): string; hook(done: Promise<Kid[]>): Promise<Kid | undefined> }
class Dev { tag: string; constructor(tag: string) { this.tag = tag; } }
class TNode {
  children: Kid[] = [];
  material: Mat | null = null;
  _device: Dev | null | undefined = undefined;
  ortho: Kid | null = null;
}
const kid = (id: number): Kid => ({ id, describe() { return "kid" + id; }, async hook() { return undefined; } });
const mat = (name: string): Mat => ({ name, shade() { return name + "!"; }, async peers() { return undefined; } });
const a = new TNode(), b = new TNode();
a.children = [kid(1), kid(2)];
b.material = mat("steel");
const ac: any = a, bc: any = b;
// identity writes: the value is the typed value itself
const before = a.children;
console.log(selfAssign(ac).length, a.children === before, a.children[1]!.describe());
console.log(copyMaterial(ac, bc).shade(), a.material === b.material);
// null and undefined into nullable typed fields store the unit arm
console.log(setDevice(ac, null), a._device === null);
console.log(setDevice(ac, undefined), a._device === undefined);
const dev = new Dev("gpu0");
console.log(setDevice(ac, dev) === dev, a._device === dev);
console.log(setOrtho(ac, null), a.ortho);
const k = kid(9);
console.log(setOrtho(ac, k) === k, a.ortho === k);
// children assigned from another typed array: identity too
console.log(setChildren(ac, b.children) === b.children, a.children === b.children);
// function boxing by reference: results and arguments that are records with methods
const box = { make(label: string): Mat { return mat(label); }, take(item: Kid): string { return item.describe(); } };
console.log(callBack(box), passThrough(box, kid(5)));
