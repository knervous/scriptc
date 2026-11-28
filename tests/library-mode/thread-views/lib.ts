// Borrowed host memory (mutable-bytes) in a thread-instanced archive: every embedder thread's instance views the same
// host buffers in place. count() claims through Atomics on an Int32Array over one shared cell, stamp() writes the
// thread's id into its own slice, and sum() reads the whole buffer back.
export function count(cells: Uint8Array, n: number): number {
  const c = new Int32Array(cells.buffer, cells.byteOffset, cells.byteLength >> 2);
  let mine = 0;
  for (let i = 0; i < n; i++) if (Atomics.add(c, 0, 1) % 2 === 0) mine++;
  return mine + Atomics.load(c, 1);
}
export function stamp(out: Uint8Array, v: number): void { out.fill(v); }
export function sum(all: Uint8Array): number { let s = 0; for (let i = 0; i < all.length; i++) s += all[i]!; return s; }
