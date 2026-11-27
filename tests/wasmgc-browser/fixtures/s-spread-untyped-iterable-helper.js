function join(a, b, c) { return [a, b, c].join(); }
export function callSpread(x) { return join(...x); }
export function callSpreadPre(x) { return join(1, ...x); }
export function maxOf(x) { return Math.max(...x); }
export function viaMethod(target, x) { return target.push(...x); }
export function newSpread(Ctor, x) { return new Ctor(...x); }
export function literal(x) { return [...x]; }
export function isArr(x) { return Array.isArray(x); }
export var ArrayAlias = Array;
