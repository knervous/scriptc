import { expect, test } from "vitest";
import { wasmGcHostImports } from "./host.js";

// Property keys crossing as strings (key form, dyn-object.ts KEY_MARK): a symbol is its reserved name
// "\uDFFF<id>:<description>"; a string key beginning with U+DFFF carries one more U+DFFF in front. The host reads a
// key back exactly (never by a prefix parse), so no string key can reach a symbol's property or the reverse.
const host = wasmGcHostImports({}, {}).host as Record<string, (...a: unknown[]) => unknown>;
const symbolKey = (s: symbol) => host["js.symbolKey"]!(s) as string;
const symbolOf = (k: string) => host["js.symbolOf"]!(k);
const get = (o: object, k: string) => host["js.get"]!(o, k);
const set = (o: object, k: string, v: unknown) => host["js.set"]!(o, k, v);
const has = (o: object, k: string) => host["js.hasOwn"]!(o, k);
const del = (o: object, k: string) => host["js.delete"]!(o, k, 1);
/** A program's string key in key form (what compiled code passes: emitter.ts keyFormStr, dyn-object.ts intern). */
const form = (k: string) => (k.charCodeAt(0) === 0xdfff ? `\uDFFF${k}` : k);

test("two symbols sharing a description: distinct reserved names, each read back exactly", () => {
  const a = Symbol("same"), b = Symbol("same");
  const ka = symbolKey(a), kb = symbolKey(b);
  expect(ka).not.toBe(kb);
  expect(symbolKey(a)).toBe(ka);
  expect([symbolOf(ka), symbolOf(kb)]).toEqual([a, b]);
  const o: Record<string | symbol, unknown> = {};
  set(o, ka, 1);
  set(o, kb, 2);
  expect([o[a], o[b], get(o, ka), get(o, kb)]).toEqual([1, 2, 1, 2]);
  expect(Reflect.ownKeys(o)).toEqual([a, b]);
});

test("a string spelling a symbol's reserved name exactly is its own key", () => {
  const s = Symbol("exact"), name = symbolKey(s);
  const o: Record<string | symbol, unknown> = {};
  set(o, name, "symbol");
  set(o, form(name), "string");
  expect(o[s]).toBe("symbol");
  expect(o[name]).toBe("string");
  expect([get(o, name), get(o, form(name))]).toEqual(["symbol", "string"]);
  expect(Object.keys(o)).toEqual([name]);
  expect(Object.getOwnPropertySymbols(o)).toEqual([s]);
  del(o, form(name));
  expect([has(o, name), has(o, form(name))]).toEqual([1, 0]);
  expect(symbolOf(form(name))).toBe(name);
});

test("a prefix lookalike (lone U+DFFF, the id's digits, junk) never reads the symbol", () => {
  const s = Symbol("p"), name = symbolKey(s);
  const id = name.slice(1, name.indexOf(":"));
  const o: Record<string | symbol, unknown> = { [s]: "symbol" };
  for (const look of [`\uDFFF${id}junk`, `\uDFFF${id}`, `\uDFFF${id}:Symbol(other)`, "\uDFFF", "\uDFFF\uDFFF"]) {
    expect(get(o, form(look))).toBeUndefined();
    set(o, form(look), look);
    expect(o[look]).toBe(look);
    expect(get(o, form(look))).toBe(look);
    // Not in key form (a raw string the program never sends): itself, not the symbol.
    if (look.charCodeAt(1) !== 0xdfff && look.length > 1) expect(symbolOf(look)).toBe(look);
  }
  expect(o[s]).toBe("symbol");
  expect(Object.getOwnPropertySymbols(o)).toEqual([s]);
  expect(Object.keys(o)).toHaveLength(5);
});

test("ordinary strings are themselves", () => {
  const o: Record<string, unknown> = {};
  set(o, "plain", 1);
  set(o, "", 2);
  expect([get(o, "plain"), get(o, ""), symbolOf("plain")]).toEqual([1, 2, "plain"]);
});
