// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Generates packages/compiler/src/ir/codec.generated.ts, the coders of the
// IR's binary encoding (codec.ts describes the bytes), from the types in
// ir.ts: every field of every type IrModule and IrFunction reach, in
// declaration order. `--check` fails when the file is stale, so a field
// added to ir.ts cannot be dropped by the encoding.
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");
const irPath = join(root, "packages/compiler/src/ir/ir.ts");
const target = join(root, "packages/compiler/src/ir/codec.generated.ts");
const samePath = (a, b) => a.replace(/\\/g, "/") === b.replace(/\\/g, "/");

/** The text of codec.generated.ts for `irText`, the source of ir.ts. */
export function generateIrCodec(irText = readFileSync(irPath, "utf8")) {
  const options = { strict: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile;
  host.getSourceFile = (file, languageVersion, ...rest) =>
    samePath(file, irPath)
      ? ts.createSourceFile(file, irText, languageVersion)
      : readSourceFile.call(host, file, languageVersion, ...rest);
  const program = ts.createProgram([irPath], options, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(irPath);

  /** The types ir.ts exports by name, by declaration node. */
  const exported = new Map();
  ts.forEachChild(source, (node) => {
    if (!ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node)) return;
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;
    if (node.typeParameters?.length) return;
    exported.set(node.name.text, checker.getTypeAtLocation(node.name));
  });

  const fail = (what) => {
    throw new Error(`generate-ir-codec: ${what}`);
  };
  const flagsOf = (t) => t.flags;
  const isUndefined = (t) => (flagsOf(t) & ts.TypeFlags.Undefined) !== 0;
  const isNull = (t) => (flagsOf(t) & ts.TypeFlags.Null) !== 0;
  /** Whether `t` has no values: never, or an intersection whose
   * discriminants conflict (`IrType & { kind: "record" }`'s other arms). */
  const empty = (t) =>
    (t.flags & ts.TypeFlags.Never) !== 0 ||
    checker.typeToString(t) === "never" ||
    (t.isIntersection() && checker.getPropertiesOfType(t).some((p) => (checker.getTypeOfSymbol(p).flags & ts.TypeFlags.Never) !== 0));
  const members = (t) => (t.isUnion() ? t.types.filter((m) => !empty(m)) : [t]);
  const isString = (t) => (flagsOf(t) & ts.TypeFlags.StringLike) !== 0;
  const isNumber = (t) => (flagsOf(t) & ts.TypeFlags.NumberLike) !== 0;
  const isBoolean = (t) => (flagsOf(t) & ts.TypeFlags.BooleanLike) !== 0;
  const isObject = (t) =>
    (flagsOf(t) & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0 && !checker.isArrayType(t);

  /** `t`'s name when ir.ts exports it by that name. */
  function nameOf(t) {
    for (const [name, named] of exported) if (named === t) return name;
    return null;
  }

  /** The literal value of `t`'s `kind` property, as a list, or null. */
  function kindsOf(t) {
    if (!isObject(t)) return null;
    const prop = checker.getPropertyOfType(t, "kind");
    if (!prop) return null;
    const values = [];
    for (const m of members(checker.getTypeOfSymbol(prop))) {
      if (!m.isStringLiteral()) return null;
      values.push(m.value);
    }
    return values;
  }

  // Each coded type: { id, name, text, type, shape }; types are coded in
  // the order they are reached.
  const coded = [];
  const byType = new Map();
  const keyLists = [];
  const keyIndex = new Map();
  const imports = new Set();

  /** The index of the key list `keys`, shared between equal lists. */
  function keysId(keys) {
    const text = JSON.stringify(keys);
    let id = keyIndex.get(text);
    if (id === undefined) {
      id = keyLists.length;
      keyLists.push(text);
      keyIndex.set(text, id);
    }
    return id;
  }

  /** The coded type of `t` (a non-null, defined type) reached as `text`. */
  function codedOf(t, text, where) {
    const known = byType.get(t);
    if (known) return known;
    const name = nameOf(t);
    if (name) imports.add(name);
    const entry = { id: coded.length, name: name ?? `T${coded.length}`, text: name ?? text, type: t, where };
    byType.set(t, entry);
    coded.push(entry);
    return entry;
  }

  /** How a value of `t` (non-null, defined) is coded: a primitive or a coded type. */
  function valueOf(t, text, where) {
    const parts = members(t);
    if (parts.every(isString)) return { prim: "str", cast: !(flagsOf(t) & ts.TypeFlags.String) };
    if (parts.every(isNumber)) return { prim: "num", cast: !(flagsOf(t) & ts.TypeFlags.Number) };
    if (parts.every(isBoolean)) return { prim: "bool", cast: !(t.isUnion() && parts.length === 2) && !(flagsOf(t) & ts.TypeFlags.Boolean) };
    if (checker.isTupleType(t)) fail(`tuple at ${where}`);
    if (checker.isArrayType(t) || isObject(t) || t.isUnion()) return { coded: codedOf(t, text, where) };
    fail(`no coding for ${checker.typeToString(t)} at ${where}`);
  }

  /** A field `prop` of the object `owner` (coded as `ownerText`). */
  function fieldOf(prop, ownerText, where) {
    const declared = checker.getTypeOfSymbol(prop);
    const name = prop.name;
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 || members(declared).some(isUndefined);
    const nullable = members(declared).some(isNull);
    const rest = members(declared).filter((m) => !isUndefined(m) && !isNull(m));
    if (rest.length === 0) fail(`field ${name} at ${where} holds only null or undefined`);
    const type = checker.getNonNullableType(declared);
    if (members(type).length !== rest.length) fail(`field ${name} at ${where}: unexpected non-null type`);
    const text = `NonNullable<${ownerText}[${JSON.stringify(name)}]>`;
    const value = valueOf(type, text, `${where}.${name}`);
    return { name, optional, nullable, value, text, file: name === "file" && value.prim === "str" && !value.cast };
  }

  /** The fields of the object type `t`, coded as `text`, less `skip`. */
  function fieldsOf(t, text, where, skip) {
    const props = checker.getPropertiesOfType(t);
    const keys = props.map((p) => p.name);
    const fields = [];
    for (const prop of props) {
      if (prop.name === skip) continue;
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (decl && (ts.isMethodSignature(decl) || ts.isMethodDeclaration(decl))) fail(`method ${prop.name} at ${where}`);
      fields.push(fieldOf(prop, text, where));
    }
    return { keys: keysId(keys), fields };
  }

  /** The shape of coded type `entry`: array, object, kind union or arms. */
  function shapeOf(entry) {
    const t = entry.type;
    if (checker.isArrayType(t)) {
      const elem = checker.getTypeArguments(t)[0];
      const elemText = `NonNullable<${entry.text}[number]>`;
      const nullable = members(elem).some(isNull);
      if (members(elem).some(isUndefined)) fail(`undefined array element at ${entry.where}`);
      const inner = checker.getNonNullableType(elem);
      return { kind: "array", nullable, elemText: `${entry.text}[number]`, value: valueOf(inner, elemText, `${entry.where}[]`) };
    }
    const parts = members(t);
    if (parts.length === 1 || !t.isUnion() || (parts.length === 2 && parts.every(isBoolean))) {
      const only = parts.length === 1 ? parts[0] : t;
      if (!isObject(only)) fail(`no coding for ${checker.typeToString(t)} at ${entry.where}`);
      return { kind: "object", ...fieldsOf(only, entry.text, entry.where) };
    }
    const objects = parts.filter(isObject);
    if (objects.length === parts.length && objects.every((m) => kindsOf(m))) {
      const byKind = new Map();
      for (const m of objects) for (const k of kindsOf(m)) byKind.set(k, [...(byKind.get(k) ?? []), m]);
      const arms = [...byKind.keys()].sort().map((kind) => {
        const ms = byKind.get(kind);
        if (ms.length > 1) fail(`kind ${kind} has ${ms.length} arms at ${entry.where}`);
        const text = `Extract<${entry.text}, { kind: ${JSON.stringify(kind)} }>`;
        return { kind, text, ...fieldsOf(ms[0], text, `${entry.where}<${kind}>`, "kind") };
      });
      return { kind: "kinds", arms };
    }
    // Other unions: primitives by typeof, arrays by Array.isArray, objects
    // by a property only their arm has.
    const arms = [];
    const strings = parts.filter(isString);
    const numbers = parts.filter(isNumber);
    const booleans = parts.filter(isBoolean);
    if (strings.length) arms.push({ test: `typeof v === "string"`, value: { prim: "str", cast: true } });
    if (numbers.length) arms.push({ test: `typeof v === "number"`, value: { prim: "num", cast: true } });
    if (booleans.length) arms.push({ test: `typeof v === "boolean"`, value: { prim: "bool", cast: true } });
    const arrays = parts.filter((m) => checker.isArrayType(m));
    if (arrays.length > 1) fail(`two array arms at ${entry.where}`);
    if (arrays.length) {
      const text = `Extract<${entry.text}, readonly unknown[]>`;
      arms.push({ test: `Array.isArray(v)`, value: valueOf(arrays[0], text, `${entry.where}[]`), text });
    }
    const leftover = parts.filter((m) => !isString(m) && !isNumber(m) && !isBoolean(m) && !checker.isArrayType(m) && !isObject(m));
    if (leftover.length) fail(`no coding for ${checker.typeToString(leftover[0])} at ${entry.where}`);
    const required = (x) => checker.getPropertiesOfType(x).filter((p) => !(p.flags & ts.SymbolFlags.Optional));
    const has = (x, name) => checker.getPropertyOfType(x, name) !== undefined;
    for (const m of objects) {
      const others = objects.filter((o) => o !== m);
      let test = null;
      let text = null;
      const key = required(m).find((p) => others.every((o) => !has(o, p.name)));
      if (key) {
        test = `typeof v === "object" && ${JSON.stringify(key.name)} in v`;
        text = `Extract<${entry.text}, { ${key.name}: unknown }>`;
      } else {
        // One level down: a required object field whose own required
        // field the other arms' same field lacks.
        for (const p of required(m)) {
          const inner = checker.getTypeOfSymbol(p);
          if (!isObject(inner)) continue;
          const sub = required(inner).find((q) =>
            others.every((o) => {
              const op = checker.getPropertyOfType(o, p.name);
              return !op || !has(checker.getNonNullableType(checker.getTypeOfSymbol(op)), q.name);
            }),
          );
          if (!sub) continue;
          const at = JSON.stringify(p.name);
          test = `typeof v === "object" && ${at} in v && ${JSON.stringify(sub.name)} in (v as { ${p.name}: object }).${p.name}`;
          text = `Extract<${entry.text}, { ${p.name}: { ${sub.name}: unknown } }>`;
          break;
        }
      }
      if (!test) fail(`no property tells an arm of ${entry.where} apart: ${checker.typeToString(m)}`);
      arms.push({ test, value: valueOf(m, text, `${entry.where}{${checker.typeToString(m)}}`), text });
    }
    return { kind: "arms", arms };
  }

  for (const [name] of [["IrModule"], ["IrFunction"]]) codedOf(exported.get(name) ?? fail(`no ${name}`), name, name);
  for (let i = 0; i < coded.length; i++) coded[i].shape = shapeOf(coded[i]);

  const out = [];
  const encValue = (value, expr, field) => {
    if (value.prim) return `w.${field?.file ? "file" : value.prim}(${expr});`;
    return `enc${value.coded.name}(w, ${expr});`;
  };
  const decValue = (value, text) => {
    if (value.prim) return value.cast ? `(r.${value.prim}() as ${text})` : `r.${value.prim}()`;
    return `dec${value.coded.name}(r)`;
  };
  const indent = (lines, by) => lines.map((l) => " ".repeat(by) + l);

  function encFields(shape) {
    const lines = [`w.keys(Object.keys(v), KEYS${shape.keys});`];
    for (const f of shape.fields) {
      const expr = `v.${f.name}`;
      const write = encValue(f.value, expr, f);
      if (f.optional && f.nullable) {
        lines.push(`if (${expr} === undefined) w.byte(0);`, `else if (${expr} === null) w.byte(1);`, "else {", "  w.byte(2);", `  ${write}`, "}");
      } else if (f.optional || f.nullable) {
        lines.push(`if (${expr} === ${f.optional ? "undefined" : "null"}) w.byte(0);`, "else {", "  w.byte(1);", `  ${write}`, "}");
      } else lines.push(write);
    }
    return lines;
  }
  function decFields(shape, text, where, kind) {
    const lines = [];
    const parts = kind === undefined ? [] : [`kind: ${JSON.stringify(kind)}`];
    shape.fields.forEach((f, i) => {
      const read = decValue(f.value, f.text);
      const at = JSON.stringify(`${where}.${f.name}`);
      let expr = read;
      if (f.optional && f.nullable) expr = `r.tag(3, ${at}) === 0 ? undefined : r.lastTag === 1 ? null : ${read}`;
      else if (f.optional) expr = `r.tag(2, ${at}) === 0 ? undefined : ${read}`;
      else if (f.nullable) expr = `r.tag(2, ${at}) === 0 ? null : ${read}`;
      lines.push(`const f${i} = ${expr};`);
      parts.push(f.optional ? `...(f${i} !== undefined ? { ${f.name}: f${i} } : {})` : `${f.name}: f${i}`);
    });
    lines.push(`const o: ${text} = { ${parts.join(", ")} };`, "return o;");
    return lines;
  }

  for (const entry of coded) {
    const { shape, name, text, where } = entry;
    if (shape.kind === "array") {
      const elem = `${text}[number]`;
      const write = encValue(shape.value, "item");
      const read = decValue(shape.value, `NonNullable<${elem}>`);
      out.push(
        `function enc${name}(w: IrWriter, v: ${text}): void {`,
        "  w.length(v.length);",
        "  for (const item of v) {",
        ...(shape.nullable ? ["    if (item === null) w.byte(0);", "    else {", "      w.byte(1);", `      ${write}`, "    }"] : [`    ${write}`]),
        "  }",
        "}",
        `function dec${name}(r: IrReader): ${text} {`,
        "  const length = r.length();",
        `  const out: ${elem}[] = [];`,
        `  for (let i = 0; i < length; i++) out.push(${shape.nullable ? `r.tag(2, ${JSON.stringify(`${where}[]`)}) === 0 ? null : ${read}` : read});`,
        "  return out;",
        "}",
        "",
      );
    } else if (shape.kind === "object") {
      out.push(
        `function enc${name}(w: IrWriter, v: ${text}): void {`,
        ...indent(encFields(shape), 2),
        "}",
        `function dec${name}(r: IrReader): ${text} {`,
        ...indent(decFields(shape, text, where), 2),
        "}",
        "",
      );
    } else if (shape.kind === "kinds") {
      out.push(`function enc${name}(w: IrWriter, v: ${text}): void {`, "  switch (v.kind) {");
      shape.arms.forEach((arm, i) => {
        out.push(`    case ${JSON.stringify(arm.kind)}: {`, `      w.length(${i});`, ...indent(encFields(arm), 6), "      return;", "    }");
      });
      out.push("  }", `  w.refuse(${JSON.stringify(`${name} kind `)} + String((v as { kind: unknown }).kind));`, "}");
      out.push(`function dec${name}(r: IrReader): ${text} {`, "  switch (r.length()) {");
      shape.arms.forEach((arm, i) => {
        out.push(`    case ${i}: {`, ...indent(decFields(arm, arm.text, `${where}<${arm.kind}>`, arm.kind), 6), "    }");
      });
      out.push("  }", `  throw new Error("IR codec: invalid ${name} kind");`, "}", "");
    } else {
      out.push(`function enc${name}(w: IrWriter, v: ${text}): void {`);
      shape.arms.forEach((arm, i) => {
        const expr = arm.text ? `v as ${arm.text}` : "v";
        out.push(`  if (${arm.test}) {`, `    w.length(${i});`, `    ${encValue(arm.value, expr)}`, "    return;", "  }");
      });
      out.push(`  throw new Error("IR codec: no arm of ${name} matches");`, "}");
      out.push(`function dec${name}(r: IrReader): ${text} {`, "  switch (r.length()) {");
      shape.arms.forEach((arm, i) => {
        out.push(`    case ${i}:`, `      return ${arm.value.prim ? `r.${arm.value.prim}()` : `dec${arm.value.coded.name}(r)`} as ${text};`);
      });
      out.push("  }", `  throw new Error("IR codec: invalid ${name} arm");`, "}", "");
    }
  }

  const keys = keyLists.map((list, i) => `const KEYS${i}: readonly string[] = ${list};`);
  const body = [...keys, "", ...out].join("\n");
  const layout = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return [
    "// Generated from packages/compiler/src/ir/ir.ts by scripts/generate-ir-codec.mjs.",
    "// Run `pnpm generate:ir-codec` after changing the IR's types.",
    `import type { ${[...imports].sort().join(", ")} } from "./ir.js";`,
    `import type { IrReader, IrWriter } from "./codec.js";`,
    "",
    "/** A digest of the coders below: an encoding written with other coders is",
    " * refused instead of misread, also after a change that keeps IR_VERSION. */",
    `export const IR_CODEC_LAYOUT = "${layout}";`,
    "",
    "/** Writes `mod` field by field (codec.ts describes the bytes). */",
    "export function encodeIrModule(w: IrWriter, mod: IrModule): void {",
    "  encIrModule(w, mod);",
    "}",
    "/** Reads a module encodeIrModule wrote. */",
    "export function decodeIrModule(r: IrReader): IrModule {",
    "  return decIrModule(r);",
    "}",
    "/** Writes one function. */",
    "export function encodeIrFunction(w: IrWriter, fn: IrFunction): void {",
    "  encIrFunction(w, fn);",
    "}",
    "/** Reads a function encodeIrFunction wrote. */",
    "export function decodeIrFunction(r: IrReader): IrFunction {",
    "  return decIrFunction(r);",
    "}",
    "",
    body,
  ].join("\n");
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const text = generateIrCodec();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {}
    if (current !== text) {
      console.error("packages/compiler/src/ir/codec.generated.ts is stale; run `pnpm generate:ir-codec`");
      process.exit(1);
    }
  } else writeFileSync(target, text);
}
