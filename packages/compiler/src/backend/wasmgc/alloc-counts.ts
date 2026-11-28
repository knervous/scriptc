/* Debug aid (SCRIPTC_WASMGC_ALLOC_COUNTS=1): the finished module with a counter per GC allocation site, so a harness can
 * see what a program allocates (benchmarks/frameworks/run.mjs --count).
 *
 * It runs on the final binary, after optimisation, so it counts the allocations the shipped code makes: a site the
 * optimiser removed has no counter, and one it kept is counted exactly as often as it runs. The module is printed as
 * text by the vendored wasm-opt, each struct.new / array.new form inside a function body is wrapped in a block that
 * first increments its own i32 global, and the text is assembled again. Each counter is exported as
 * `__alloc.<site>|<function>|<instruction>:<type>`. Global initializers are constant expressions and keep their
 * allocations uncounted. The text form drops custom sections, so the original's (all but the name section, which the
 * assembled module has its own copy of) are appended to the result. */

const ALLOCATING = /^\((struct\.new(?:_default)?|array\.new(?:_default|_fixed|_data|_elem)?)\s+(\$[^\s()]+|\d+)/;

/** The index just past the form that opens at `start` (a `(`), skipping strings and comments. */
function formEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === ";" && text[i + 1] === ";") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "(" && text[i + 1] === ";") {
      const close = text.indexOf(";)", i + 2);
      i = close < 0 ? text.length : close + 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  throw new Error("alloc-counts: unbalanced module text");
}

/** The module text with every allocation in a function body counted, and the counters it added (global name, label). */
export function countAllocationsInText(text: string): { text: string; counters: { global: string; label: string }[] } {
  const counters: { global: string; label: string }[] = [];
  const out: string[] = [];
  // The module's top-level forms, one at a time: only a (func ...) form's body is rewritten.
  const open = text.indexOf("(module");
  if (open < 0) throw new Error("alloc-counts: no (module ...) in the text");
  const moduleEnd = formEnd(text, open);
  let i = text.indexOf("(", open + 1);
  out.push(text.slice(0, i));
  while (i >= 0 && i < moduleEnd - 1) {
    const end = formEnd(text, i);
    const form = text.slice(i, end);
    out.push(form.startsWith("(func ") ? countInFunction(form, counters) : form);
    const next = text.indexOf("(", end);
    if (next < 0 || next >= moduleEnd - 1) { out.push(text.slice(end, moduleEnd - 1)); break; }
    out.push(text.slice(end, next));
    i = next;
  }
  for (const { global, label } of counters) out.push(`\n (global ${global} (mut i32) (i32.const 0))\n (export ${JSON.stringify(label)} (global ${global}))`);
  out.push(text.slice(moduleEnd - 1));
  return { text: out.join(""), counters };
}

function countInFunction(form: string, counters: { global: string; label: string }[]): string {
  const owner = /^\(func\s+(\$(?:"(?:[^"\\]|\\.)*"|\S+))/.exec(form)?.[1] ?? "$?";
  const name = owner.startsWith('$"') ? JSON.parse(owner.slice(1)) as string : owner.slice(1);
  // Rewritten innermost first: each allocation form found is wrapped, and the scan goes on inside it.
  // (`from` 1 skips the function's own opening paren; the inside of a wrapped form is scanned from its start)
  const wrap = (s: string, from: number): string => {
    let result = "";
    let at = 0;
    for (let k = s.indexOf("(", from); k >= 0; k = s.indexOf("(", k + 1)) {
      const m = ALLOCATING.exec(s.slice(k, k + 200));
      if (!m) continue;
      const end = formEnd(s, k);
      const global = `$__alloc.${counters.length}`;
      counters.push({ global, label: `__alloc.${counters.length}|${name}|${m[1]}:${m[2]}` });
      result += s.slice(at, k) + `(block (result (ref (exact ${m[2]}))) (global.set ${global} (i32.add (global.get ${global}) (i32.const 1))) ` +
        m[0] + wrap(s.slice(k + m[0].length, end - 1), 0) + "))";
      at = end;
      k = end - 1;
    }
    return result + s.slice(at);
  };
  return wrap(form, 1);
}

/** The custom sections of a binary (id 0), except `name`: the raw bytes of each, header included. */
export function customSections(binary: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const leb = (at: number): [number, number] => {
    let value = 0, shift = 0, i = at;
    for (;;) { const b = binary[i++]!; value += (b & 0x7f) * 2 ** shift; shift += 7; if (b < 0x80) return [value, i]; }
  };
  for (let i = 8; i < binary.length;) {
    const id = binary[i]!, [size, body] = leb(i + 1), end = body + size;
    if (id === 0) {
      const [nameLength, nameAt] = leb(body);
      const name = new TextDecoder().decode(binary.subarray(nameAt, nameAt + nameLength));
      if (name !== "name") out.push(binary.subarray(i, end));
    }
    i = end;
  }
  return out;
}

/** `binary` with its allocations counted (see the head of this file). `wasmOpt` runs the vendored wasm-opt with the
 * backend's features; `dir` is a scratch directory the caller owns. */
export function countAllocations(binary: Uint8Array, wasmOpt: (args: string[]) => void, dir: string,
  fs: { writeFileSync(p: string, d: Uint8Array | string): void; readFileSync(p: string, e?: "utf8"): Uint8Array | string },
  join: (...p: string[]) => string): Uint8Array {
  const input = join(dir, "alloc-in.wasm"), textIn = join(dir, "alloc-in.wat"), textOut = join(dir, "alloc-out.wat"), output = join(dir, "alloc-out.wasm");
  fs.writeFileSync(input, binary);
  wasmOpt(["-g", input, "-S", "-o", textIn]);
  const { text } = countAllocationsInText(fs.readFileSync(textIn, "utf8") as string);
  fs.writeFileSync(textOut, text);
  wasmOpt(["-g", textOut, "-o", output]);
  const counted = fs.readFileSync(output) as Uint8Array;
  const extra = customSections(binary);
  const result = new Uint8Array(counted.length + extra.reduce((n, s) => n + s.length, 0));
  result.set(counted, 0);
  let at = counted.length;
  for (const s of extra) { result.set(s, at); at += s.length; }
  return result;
}
