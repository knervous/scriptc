import { shared, cursor, describe } from "./a.ts";
export interface Cursor<T> { current: T }
export function createCursor<T>(value: T): Cursor<T> { return { current: value }; }
export const registry: string[] = [];
export function register(name: string): void { registry.push(name); }
// a ran first (b is its dependency): a's bindings are initialized here
shared.S = 5;
shared.hits += 1;
cursor.current = "child";
register("b");
console.log(describe(), registry.join(","));
