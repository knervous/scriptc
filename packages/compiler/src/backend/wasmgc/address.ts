/* Module-memory addresses at the host boundary. A wasm32 address crosses as an i32, which JS reads signed: from
 * 2 GiB on it arrives negative (a shared memory that large is reached by a large program's data load). */

/** The address an i32 carries: `>>> 0`, so 0x80000000 is 2147483648 and not -2147483648. */
export function moduleAddress(raw: number): number {
  return raw >>> 0;
}

/** The byte span [address, address + byteLength) inside a buffer of `available` bytes, or a RangeError naming it
 * (a wrapped or overrunning span must never become a view of other memory). */
export function memorySpan(raw: number, byteLength: number, available: number): { start: number; end: number } {
  const start = moduleAddress(raw);
  const end = start + byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || end > available) {
    throw new RangeError(`module memory span ${start}+${byteLength} lies outside ${available} bytes`);
  }
  return { start, end };
}
