import { expect, test } from "vitest";
import { countAllocationsInText, customSections } from "./alloc-counts.js";

const text = `(module
 (type $box (struct (field i32)))
 (type $list (array (mut (ref null $box))))
 (global $one (ref $box) (struct.new $box (i32.const 1)))
 (data $d "(not a form")
 (func $make (result (ref $list))
  (array.new_fixed $list 2
   (struct.new $box
    (i32.const 2)
   )
   (struct.new_default $box)
  )
 )
 (func $plain (result i32)
  (i32.const 0)
 )
)
`;

test("each allocation in a function body is counted, nested ones included; a global initializer is left alone", () => {
  const { text: out, counters } = countAllocationsInText(text);
  expect(counters.map((c) => c.label)).toEqual([
    "__alloc.0|make|array.new_fixed:$list",
    "__alloc.1|make|struct.new:$box",
    "__alloc.2|make|struct.new_default:$box",
  ]);
  expect(out).toContain("(global $one (ref $box) (struct.new $box (i32.const 1)))");
  expect(out).toContain('(data $d "(not a form")');
  expect(out).toContain("(block (result (ref (exact $box))) (global.set $__alloc.2 (i32.add (global.get $__alloc.2) (i32.const 1))) (struct.new_default $box))");
  expect(out).toContain('(export "__alloc.0|make|array.new_fixed:$list" (global $__alloc.0))');
  // Every paren the transform opens it closes.
  const depth = [...out.replace(/"[^"]*"/g, '""')].reduce((d, c) => d + (c === "(" ? 1 : c === ")" ? -1 : 0), 0);
  expect(depth).toBe(0);
  expect(out).toContain("(func $plain (result i32)\n  (i32.const 0)\n )");
});

test("custom sections other than the name section are kept, raw", () => {
  const section = (name: string, payload: number[]) => {
    const n = [...new TextEncoder().encode(name)];
    const body = [n.length, ...n, ...payload];
    return [0, body.length, ...body];
  };
  const binary = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section("name", [1, 2]), 1, 1, 0, ...section("scriptc.caps", [9])]);
  const kept = customSections(binary);
  expect(kept.length).toBe(1);
  expect([...kept[0]!]).toEqual(section("scriptc.caps", [9]));
});
