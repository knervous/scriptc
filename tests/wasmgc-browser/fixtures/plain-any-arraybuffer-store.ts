// @plain-native-only: TS `any` is a page value in the plain native lane, where a compiled ArrayBuffer has no page form that is an ArrayBuffer
// @native-refuses: a compiled typed array's .buffer stored into page-typed `any` is a loud TypeError (it used to arrive as a Uint8Array view: isView true, instanceof false, set() copying); a direct page-function argument keeps the byte view (ledger B002)
// @expect-native: TypeError true
// @expect-native: TypeError true
// Residual (not guarded): x.buffer.byteLength of a typed array held as `any` reports the memory size in this lane.
const u = new Uint8Array([1, 2, 3, 4]);
function attempt(f: () => void): string {
  try { f(); return "no error"; } catch (e) { return `${(e as Error).name} ${(e as Error).message.startsWith("a compiled ArrayBuffer")}`; }
}
function giveBack(): any { const x: any = u.buffer; return x; }
console.log(attempt(() => { giveBack(); }));
console.log(attempt(() => { const holder: any = {}; holder.b = u.buffer; }));
