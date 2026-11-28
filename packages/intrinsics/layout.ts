/* @scriptc-intrinsics layout/1 */
/* Fixed-layout records in linear memory: arrays of structs with declared
 * field types, offsets and alignment, little-endian, read and written in
 * place over any byte view (zero-copy: a GPU upload buffer, a
 * network packet, a file).
 *
 * One schema, several sides (the host-stream idea): `layout()` computes the
 * offsets, `layoutSource()` generates a TypeScript view class with one getter
 * and setter per field at constant offsets, and `cStruct()` / `wgslStruct()`
 * print the same layout for C and WGSL. The generated class is plain code over
 * DataView: Node runs it as written; scriptc compiles each accessor to a
 * fixed-offset load or store (WasmGC: a bounds-checked load on module memory;
 * native: a load at the C struct's offset). `RecordView` is the same thing
 * without generation, for code that names fields by offset. */

export type FieldType = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f16" | "f32" | "f64" | "u64" | "i64";

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** A fixed array of this many elements (default 1). */
  count?: number;
}

export interface LayoutField {
  name: string;
  type: FieldType;
  count: number;
  offset: number;
  size: number;
}

export interface Layout {
  name: string;
  fields: LayoutField[];
  /** Bytes the fields span (the last field's end). */
  size: number;
  /** The largest field alignment, or the requested one. */
  align: number;
  /** Bytes from one record to the next: size rounded up to align. */
  stride: number;
}

export interface LayoutOptions {
  /** Pack fields with no padding (alignment 1). Default false: each field at a multiple of its size, C's rule. */
  packed?: boolean;
  /** Round the stride up to this alignment (for example 16 for a WGSL uniform array). */
  align?: number;
}

const SIZES: Readonly<Record<FieldType, number>> = { u8: 1, i8: 1, u16: 2, i16: 2, f16: 2, u32: 4, i32: 4, f32: 4, f64: 8, u64: 8, i64: 8 };

/** Byte size of one element of `type`. */
export function fieldSize(type: FieldType): number {
  return SIZES[type];
}

/** Offsets, size, alignment and stride for `fields` in order. */
export function layout(name: string, fields: FieldSpec[], options: LayoutOptions = {}): Layout {
  const out: LayoutField[] = [];
  let at = 0, align = 1;
  for (const f of fields) {
    const size = SIZES[f.type];
    if (size === undefined) throw new TypeError(`layout ${name}: field ${f.name} has unknown type ${f.type}`);
    const count = f.count ?? 1;
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`layout ${name}: field ${f.name} needs a positive count`);
    const fieldAlign = options.packed ? 1 : size;
    at = Math.ceil(at / fieldAlign) * fieldAlign;
    out.push({ name: f.name, type: f.type, count, offset: at, size: size * count });
    at += size * count;
    if (fieldAlign > align) align = fieldAlign;
  }
  if (options.align !== undefined) align = Math.max(align, options.align);
  return { name, fields: out, size: at, align, stride: Math.ceil(at / align) * align };
}

/** A record array over a buffer: `length` records of `stride` bytes from `byteOffset`, little-endian. */
export class RecordView {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly stride: number;
  readonly length: number;
  /** `length` records (default: as many as fit) of `stride` bytes at the start of `bytes`, in place: the view shares
   * the bytes' buffer, so writes through either are seen by both. Pass `new Uint8Array(buffer, offset)` for a raw
   * buffer. */
  constructor(bytes: Uint8Array, stride: number, length?: number) {
    const n = length ?? Math.floor(bytes.byteLength / stride);
    if (n * stride > bytes.byteLength) throw new RangeError(`RecordView: ${n} records of ${stride} bytes do not fit in ${bytes.byteLength} bytes`);
    this.view = new DataView(bytes.buffer, bytes.byteOffset, n * stride);
    this.bytes = bytes.subarray(0, n * stride);
    this.stride = stride;
    this.length = n;
  }
  u8(i: number, offset: number): number { return this.view.getUint8(i * this.stride + offset); }
  i8(i: number, offset: number): number { return this.view.getInt8(i * this.stride + offset); }
  u16(i: number, offset: number): number { return this.view.getUint16(i * this.stride + offset, true); }
  i16(i: number, offset: number): number { return this.view.getInt16(i * this.stride + offset, true); }
  u32(i: number, offset: number): number { return this.view.getUint32(i * this.stride + offset, true); }
  i32(i: number, offset: number): number { return this.view.getInt32(i * this.stride + offset, true); }
  f32(i: number, offset: number): number { return this.view.getFloat32(i * this.stride + offset, true); }
  f64(i: number, offset: number): number { return this.view.getFloat64(i * this.stride + offset, true); }
  setU8(i: number, offset: number, v: number): void { this.view.setUint8(i * this.stride + offset, v); }
  setI8(i: number, offset: number, v: number): void { this.view.setInt8(i * this.stride + offset, v); }
  setU16(i: number, offset: number, v: number): void { this.view.setUint16(i * this.stride + offset, v, true); }
  setI16(i: number, offset: number, v: number): void { this.view.setInt16(i * this.stride + offset, v, true); }
  setU32(i: number, offset: number, v: number): void { this.view.setUint32(i * this.stride + offset, v, true); }
  setI32(i: number, offset: number, v: number): void { this.view.setInt32(i * this.stride + offset, v, true); }
  setF32(i: number, offset: number, v: number): void { this.view.setFloat32(i * this.stride + offset, v, true); }
  setF64(i: number, offset: number, v: number): void { this.view.setFloat64(i * this.stride + offset, v, true); }
  /** Copies record `from` of `source` (same stride) over record `to` of this view. */
  copyRecord(to: number, source: RecordView, from: number): void {
    this.bytes.set(source.bytes.subarray(from * source.stride, from * source.stride + this.stride), to * this.stride);
  }
}

const GET: Readonly<Record<FieldType, string>> = {
  u8: "getUint8", i8: "getInt8", u16: "getUint16", i16: "getInt16", u32: "getUint32", i32: "getInt32",
  f16: "getUint16", f32: "getFloat32", f64: "getFloat64", u64: "getBigUint64", i64: "getBigInt64",
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** TypeScript source of a view class for `l`: `get<Field>(i)` / `set<Field>(i, v)` at constant offsets (an array field
 * takes an element index too). f16 fields import the f16 library from `f16Module`. */
export function layoutSource(l: Layout, options: { f16Module?: string } = {}): string {
  const lines: string[] = [];
  const usesF16 = l.fields.some((f) => f.type === "f16");
  lines.push(`// Generated by layoutSource() for layout ${l.name}: ${l.stride}-byte records, little-endian. Do not edit.`);
  if (usesF16) lines.push(`import { fromF16Bits, toF16Bits } from ${JSON.stringify(options.f16Module ?? "scriptw/f16")};`);
  lines.push(`export const ${l.name.toUpperCase()}_STRIDE = ${l.stride};`);
  lines.push(`export class ${l.name}View {`);
  lines.push(`  readonly view: DataView;`, `  readonly length: number;`);
  lines.push(`  /** \`length\` records (default: as many as fit) at the start of \`bytes\`, in place. */`);
  lines.push(`  constructor(bytes: Uint8Array, length?: number) {`);
  lines.push(`    const n = length ?? Math.floor(bytes.byteLength / ${l.stride});`);
  lines.push(`    if (n * ${l.stride} > bytes.byteLength) throw new RangeError("${l.name}View: " + n + " records do not fit");`);
  lines.push(`    this.view = new DataView(bytes.buffer, bytes.byteOffset, n * ${l.stride});`, `    this.length = n;`, `  }`);
  for (const f of l.fields) {
    const big = f.type === "u64" || f.type === "i64";
    const t = big ? "bigint" : "number";
    const le = f.type === "u8" || f.type === "i8" ? "" : ", true";
    const at = f.count > 1 ? `i * ${l.stride} + ${f.offset} + k * ${SIZES[f.type]}` : `i * ${l.stride} + ${f.offset}`;
    const idx = f.count > 1 ? "i: number, k: number" : "i: number";
    const read = `this.view.${GET[f.type]}(${at}${le})`;
    lines.push(`  get${cap(f.name)}(${idx}): ${t} { return ${f.type === "f16" ? `fromF16Bits(${read})` : read}; }`);
    const value = f.type === "f16" ? "toF16Bits(v)" : "v";
    lines.push(`  set${cap(f.name)}(${idx}, v: ${t}): void { this.view.${GET[f.type].replace("get", "set")}(${at}, ${value}${le}); }`);
  }
  lines.push(`}`, ``);
  return lines.join("\n");
}

const C_TYPES: Readonly<Record<FieldType, string>> = {
  u8: "uint8_t", i8: "int8_t", u16: "uint16_t", i16: "int16_t", f16: "uint16_t", u32: "uint32_t", i32: "int32_t", f32: "float", f64: "double", u64: "uint64_t", i64: "int64_t",
};
/** The layout as a C struct (stdint types; f16 fields as their uint16_t patterns), with explicit padding. */
export function cStruct(l: Layout): string {
  const lines = [`/* ${l.name}: ${l.stride} bytes, little-endian */`, `typedef struct ${l.name} {`];
  let at = 0, pad = 0;
  for (const f of l.fields) {
    if (f.offset > at) lines.push(`  uint8_t _pad${pad++}[${f.offset - at}];`);
    lines.push(`  ${C_TYPES[f.type]} ${f.name}${f.count > 1 ? `[${f.count}]` : ""}; /* offset ${f.offset} */`);
    at = f.offset + f.size;
  }
  if (l.stride > at) lines.push(`  uint8_t _pad${pad}[${l.stride - at}];`);
  lines.push(`} ${l.name};`, `_Static_assert(sizeof(${l.name}) == ${l.stride}, "${l.name} layout");`, ``);
  return lines.join("\n");
}

/** The layout as a WGSL struct for a storage buffer. WGSL has no 8-bit or 64-bit scalars and aligns vectors itself,
 * so only layouts of 32-bit fields (u32, i32, f32, and arrays of them) map one to one; others are refused. */
export function wgslStruct(l: Layout): string {
  const W: Partial<Record<FieldType, string>> = { u32: "u32", i32: "i32", f32: "f32" };
  const lines = [`// ${l.name}: ${l.stride} bytes`, `struct ${l.name} {`];
  for (const f of l.fields) {
    const t = W[f.type];
    if (!t) throw new TypeError(`wgslStruct ${l.name}: field ${f.name} (${f.type}) has no WGSL storage type; use 32-bit fields`);
    lines.push(`  ${f.name}: ${f.count > 1 ? `array<${t}, ${f.count}>` : t},`);
  }
  if (l.stride > l.size) lines.push(`  _pad: array<u32, ${(l.stride - l.size) / 4}>,`);
  lines.push(`}`, ``);
  return lines.join("\n");
}
