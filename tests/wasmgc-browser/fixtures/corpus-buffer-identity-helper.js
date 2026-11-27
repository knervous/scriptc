export function bufferIdentity() {
  const bytes = new Uint8Array(4);
  const buffer = bytes.buffer;
  const map = new WeakMap();
  map.set(buffer, 3);
  const set = new WeakSet([buffer]);
  return [buffer === bytes.buffer, bytes.subarray(1).buffer === buffer, map.get(bytes.buffer), set.has(bytes.subarray(2).buffer),
    new Uint8Array(4).buffer === buffer, buffer.byteLength].join(" ");
}
