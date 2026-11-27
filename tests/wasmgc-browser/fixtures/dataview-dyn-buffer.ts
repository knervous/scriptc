// @native-only: an ArrayBuffer as a value (engine dyn has no page form for compiled storage)
// `new DataView(buffer)` where the ArrayBuffer is a value held untyped (a fresh `new ArrayBuffer(n)` or a
// view's `.buffer` passed as an ArrayBuffer parameter): the view aliases the compiled bytes, with the
// offsets and RangeErrors of the spec. (shared-textures.ts readGlbImageUris reads a GLB header this way.)
const GLB_MAGIC = 0x46546c67;
function readHeader(bytes: ArrayBuffer): string {
  if (bytes.byteLength < 20) return "short";
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC) return "not glb";
  return `glb v${view.getUint32(4, true)} len ${view.getUint32(8, true)} chunk ${view.getUint32(12, true)}`;
}
const fresh = new ArrayBuffer(24);
const w = new DataView(fresh);
w.setUint32(0, GLB_MAGIC, true); w.setUint32(4, 2, true); w.setUint32(8, 24, true); w.setUint32(12, 4, true);
console.log(readHeader(fresh), readHeader(new ArrayBuffer(8)));
const u8 = new Uint8Array(24);
u8.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 99]);
console.log(readHeader(u8.buffer), new Uint8Array(fresh)[0]);
const tail = new DataView(fresh, 4, 8);
console.log(tail.byteLength, tail.getUint32(0, true), tail.getUint32(4, true));
try { new DataView(fresh, 30); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { new DataView(fresh, 20, 8); } catch (e) { console.log((e as Error).name, (e as Error).message); }
