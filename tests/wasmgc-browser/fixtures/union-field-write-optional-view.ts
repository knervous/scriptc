// @options: {"interfaceClassArms": true}
// A narrower record (required `cache`) flows into the wider type (optional `cache`) by reference,
// so the wider type's receiver is a union of record arms with differently typed slots. Writing the
// optional property writes the held arm's own slot (the view sees it); `??=` reads then writes only
// when the slot is empty.
interface Features { features: number }
interface Base { version: number; cache?: Features | undefined }
interface View { version: number; cache: Features }
function compute(tag: number): Features { return { features: tag }; }
function ensure(m: Base, tag: number): number { return (m.cache ??= compute(tag)).features; }
const plain: Base = { version: 1 };
const view: View = { version: 2, cache: { features: 3 } };
const shared: Base = view;
console.log(ensure(plain, 10), plain.cache?.features);
console.log(ensure(shared, 20), view.cache.features);
function replace(m: Base, tag: number): void { m.cache = compute(tag); }
replace(plain, 30);
replace(shared, 40);
console.log(plain.cache?.features, view.cache.features);
function clear(m: Base): void { m.cache = undefined; }
clear(plain);
console.log(plain.cache === undefined, ensure(plain, 50), plain.cache?.features);
// A probe cast over the union names the field's declared type; the write goes to the held arm.
interface Sig { depth: number; stamp?: number }
interface SigView { depth: number; stamp?: number; extra: string }
const sig: Sig = { depth: 1 };
const sigView: SigView = { depth: 2, extra: "e" };
const sharedSig: Sig = sigView;
function stamp(s: Sig, n: number): void { (s as { stamp?: number }).stamp = n; }
stamp(sig, 7);
stamp(sharedSig, 8);
console.log(sig.stamp, sigView.stamp, sigView.extra);
export {};
