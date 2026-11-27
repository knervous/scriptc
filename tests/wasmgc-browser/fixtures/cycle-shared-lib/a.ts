import { createCursor, register } from "./b.ts";
export const shared: { S: number | null; hits: number } = { S: null, hits: 0 };
export const cursor = createCursor<string>("root"); // a hoisted function of the module still initializing
try {
  register("a"); // reads b's registry const, which has not run yet
} catch (e) {
  console.log("a register", (e as Error).name, (e as Error).message, e instanceof ReferenceError);
}
export function describe(): string { return `${shared.S}/${shared.hits}/${cursor.current}`; }
