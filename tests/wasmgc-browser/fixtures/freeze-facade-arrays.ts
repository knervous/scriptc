// @native-any-only: page integrity of compiled arrays needs the native-any dyn model (dyn arrays and their facades)
// Page code (the page's Object.freeze / seal / preventExtensions) reaches compiled arrays and records through their facades: the compiled value
// takes the integrity level exactly, and reads and writes afterwards behave as for the real thing. (React's dev jsx freezes its children and props.)
export {};
const PO: any = (globalThis as any).Object;
const kind = (e: unknown): string => (e as Error).name;
function attempt(label: string, f: () => unknown): void {
  try { console.log(label, f()); } catch (e) { console.log(label, "threw", kind(e)); }
}
const nums: number[] = [1, 2, 3];
const dyn: any[] = [1, "two", { three: 3 }];
const rec = { a: 1, b: "x" };
const dynObj: any = JSON.parse('{"p":1,"q":[1,2]}');
interface P { children: number[]; id: number }
const props: P = { children: [4, 5], id: 7 };
const na: any = nums, da: any = dyn, ra: any = rec;
attempt("freeze nums", () => PO.freeze(nums) === nums);
attempt("frozen nums", () => PO.isFrozen(nums) + " " + PO.isSealed(nums) + " " + PO.isExtensible(nums));
attempt("freeze dyn", () => PO.freeze(dyn) === dyn);
attempt("frozen dyn", () => PO.isFrozen(dyn));
attempt("freeze rec", () => PO.freeze(rec) === rec);
attempt("freeze dynObj", () => PO.freeze(dynObj) === dynObj);
attempt("freeze props", () => PO.freeze(props) === props);
attempt("freeze props.children", () => PO.freeze(props.children) === props.children);
attempt("write nums", () => { na[0] = 9; return nums.join(); });
attempt("push nums", () => { na.push(4); return nums.join(); });
attempt("write dyn", () => { da[0] = 9; return da.length; });
attempt("push dyn", () => { da.push(4); return da.length; });
attempt("write rec", () => { ra.a = 2; return rec.a; });
attempt("add rec", () => { ra.z = 2; return Object.keys(rec).join(); });
attempt("read all", () => nums.join() + "|" + JSON.stringify(dyn) + "|" + JSON.stringify(rec) + "|" + JSON.stringify(props) + "|" + JSON.stringify(dynObj));
attempt("descriptors", () => JSON.stringify(PO.getOwnPropertyDescriptor(nums, "1")) + JSON.stringify(PO.getOwnPropertyDescriptor(dyn, "length")) + JSON.stringify(PO.getOwnPropertyNames(nums)));
// A compiled freeze first, then the page asks.
const early: number[] = [7, 8];
Object.freeze(early);
attempt("compiled-frozen", () => PO.isFrozen(early) + " " + PO.isExtensible(early) + " " + JSON.stringify(PO.getOwnPropertyDescriptor(early, "0")));
// Seal and prevent extensions on a dyn array.
const sealed: any[] = [1, { x: 1 }];
attempt("seal dyn", () => PO.seal(sealed) === sealed);
attempt("sealed", () => PO.isSealed(sealed) + " " + PO.isFrozen(sealed) + " " + PO.isExtensible(sealed));
const sa: any = sealed;
attempt("sealed write", () => { sa[0] = 5; return sealed[0]; });
attempt("sealed push", () => { sa.push(1); return sealed.length; });
const prevented: any[] = [1, 2];
attempt("prevent dyn", () => PO.preventExtensions(prevented) === prevented);
attempt("prevented", () => PO.isExtensible(prevented) + " " + PO.isSealed(prevented) + " " + PO.isFrozen(prevented));
attempt("empty freeze", () => PO.isFrozen(PO.freeze([] as number[])));
