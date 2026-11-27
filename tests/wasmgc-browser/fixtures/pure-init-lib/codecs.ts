// Module-level initialisers: pure ones (frozen literals of closures) and one with an effect.
export const USED = Object.freeze({ name: "used", decode: (b: number): number => b + 1 });
export const UNUSED = Object.freeze({
  name: "unused",
  // A closure this backend cannot compile today: kept only if its initialiser runs.
  decode: async (p: Promise<number | null>): Promise<number> => (await p) ?? (await Promise.resolve(0)),
});
export const ALIAS = Object.freeze({ inner: UNUSED, tag: 3 });
export const SIDE = (console.log("side effect runs"), 5);
export const NEEDS_SIDE = Object.freeze({ side: SIDE });
export let counter = 0;
counter += 1;
