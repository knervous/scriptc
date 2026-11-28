// A JSDoc generic whose optional parameter's type is the type parameter: a call that omits it instantiates T as
// unknown, and the parameter holds undefined (Svelte's component pop).
/**
 * @template {Record<string, any>} T
 * @param {T} [component]
 * @returns {T}
 */
export function pop(component) { return /** @type {T} */ (component ?? /** @type {any} */ ({ popped: true })); }
export function run() { const a = pop(); const b = pop({ k: 1 }); return [a.popped, b.k].join(" "); }
