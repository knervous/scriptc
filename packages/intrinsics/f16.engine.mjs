// The plain-JavaScript entry of the f16 intrinsic library: the engine's binary16 conversion where it has one (Math.f16round
// and DataView float16 methods: Chrome 135, Firefox 129, Safari 18.2), the library's software conversion elsewhere. Both
// round to nearest, ties to even, and store NaN as 0x7e00, so results are identical either way. scriptc never compiles
// this file: it compiles f16.ts.
import * as soft from "./f16.ts";

const engine = typeof Math.f16round === "function" && typeof DataView.prototype.getFloat16 === "function";
const scratch = engine ? new DataView(new ArrayBuffer(2)) : null;

export const F16_PATH = engine ? "engine" : "software";
export const toF16Bits = engine
  ? (x) => { scratch.setFloat16(0, x, true); return x !== x ? 0x7e00 : scratch.getUint16(0, true); }
  : soft.toF16Bits;
export const fromF16Bits = engine ? (h) => { scratch.setUint16(0, h, true); return scratch.getFloat16(0, true); } : soft.fromF16Bits;
export const f16round = engine ? Math.f16round : soft.f16round;
export const getFloat16 = engine ? (view, byteOffset, littleEndian = false) => view.getFloat16(byteOffset, littleEndian) : soft.getFloat16;
export const setFloat16 = engine
  ? (view, byteOffset, value, littleEndian = false) => { if (value !== value) view.setUint16(byteOffset, 0x7e00, littleEndian); else view.setFloat16(byteOffset, value, littleEndian); }
  : soft.setFloat16;
export const packF16 = engine && typeof Float16Array === "function"
  ? (src, dst, srcStart = 0, dstStart = 0, count = src.length - srcStart) => {
    const view = new Float16Array(dst.buffer, dst.byteOffset + dstStart * 2, count);
    for (let i = 0; i < count; i++) view[i] = src[srcStart + i];
    for (let i = 0; i < count; i++) if (view[i] !== view[i]) dst[dstStart + i] = 0x7e00;
  }
  : soft.packF16;
export const unpackF16 = engine && typeof Float16Array === "function"
  ? (src, dst, srcStart = 0, dstStart = 0, count = src.length - srcStart) => {
    const view = new Float16Array(src.buffer, src.byteOffset + srcStart * 2, count);
    for (let i = 0; i < count; i++) dst[dstStart + i] = view[i];
  }
  : soft.unpackF16;
