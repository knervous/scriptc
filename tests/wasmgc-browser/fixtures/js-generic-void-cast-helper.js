// A JSDoc generic that casts its result to its type parameter, instantiated with T = void when the callback is omitted
// (Svelte's flushSync).
let flushed = 0;
/**
 * @template [T=void]
 * @param {(() => T) | undefined} [fn]
 * @returns {T}
 */
export function flush(fn) {
  var result;
  if (fn) result = fn();
  flushed++;
  return /** @type {T} */ (result);
}
export function run() {
  flush();
  const n = flush(() => 41) + 1;
  flush();
  return n + " " + flushed;
}
