// A condition whose right operand has no static lowering (a WeakMap keyed by a narrowed Error) and never runs: a
// development-only branch behind a false flag, as Svelte's error handling has.
const adjustments = new WeakMap();
/** @param {unknown} error @param {boolean} dev */
export function note(error, dev) {
  if (dev && error instanceof Error && !adjustments.has(error)) return "noted";
  return "skipped";
}
/** @param {unknown} error @param {boolean} dev */
export function quick(error, dev) {
  if (!dev || (error instanceof Error && adjustments.has(error))) return "quick";
  return "slow";
}
