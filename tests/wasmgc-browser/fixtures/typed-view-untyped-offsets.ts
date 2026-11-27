// @native-only: an ArrayBuffer as a value (engine dyn has no page form for compiled storage)
// new Uint8Array(buffer, offset, length) where offset and length are untyped (parsed glTF JSON:
// gltf-interleave.ts resolveStrided `new U8(ab, binChunk.byteOffset + (bufferView.byteOffset ?? 0), bufferView.byteLength)`):
// ToIndex through ToNumber; an undefined length is an omitted one; Node's RangeErrors.
const bin = new Uint8Array(32);
for (let i = 0; i < bin.length; i++) bin[i] = i;
const chunk = new DataView(bin.buffer, 4);
const json: any = JSON.parse('{"bufferViews":[{"byteOffset":8,"byteLength":6},{"byteLength":3},{"byteOffset":20},{"byteOffset":"2","byteLength":"4"},{"byteOffset":40,"byteLength":1},{"byteOffset":0,"byteLength":99}]}');
const ab = chunk.buffer as ArrayBuffer;
for (const bv of json.bufferViews) {
  try {
    const slice = new Uint8Array(ab, chunk.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
    console.log(slice.length, slice.byteOffset, Array.from(slice).join(","));
  } catch (e) { console.log((e as Error).name, (e as Error).message); }
}
const f32 = new Float32Array(new ArrayBuffer(16), json.bufferViews[2].byteOffset - 16, json.bufferViews[1].byteLength);
console.log(f32.length, f32.byteOffset);
