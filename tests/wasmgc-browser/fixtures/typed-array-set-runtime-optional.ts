// `set` from a typed array the runtime-optional analysis holds as `T | undefined` (an unannotated binding of an
// unchecked index read) copies the typed array directly; an absent one still throws the TypeError. It read every
// element through dyn before: the client's basis transcode concatenating layers spent 9.6 s there.
// An unannotated binding of an unchecked index read holds `Uint8Array | undefined` at run time.
const pieces: Uint8Array[] = [new Uint8Array(2000000).fill(5), new Uint8Array([9, 8])];
const out = new Uint8Array(2000002);
let at = 0;

for (let k = 0; k < pieces.length; k++) {
  const piece = pieces[k];
  out.set(piece, at);
  at += piece.length;
}
console.log(out[0], out[1999999], out[2000000], out[2000001], at);
const missing = pieces[7];
try { out.set(missing, 0); console.log("no throw"); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : String(e)); }
