/* JSON.parse's numbers decided in the module: the text of a JSON number (already checked against the grammar) to the
 * double `Number(text)` gives, correctly rounded, with no host call for nearly every number a program reads.
 *
 * - Up to 19 significant digits are gathered exactly into a u64 `w`, with the decimal exponent `q` (value = w * 10^q).
 * - Clinger's fast path: w <= 2^53 and |q| <= 22, so w and 10^|q| are exact doubles and one IEEE multiply or divide
 *   rounds the exact product or quotient once.
 * - Otherwise Eisel-Lemire (Lemire, "Number Parsing at a Gigabyte per Second", 2021; fast_float's compute_float): the
 *   top bits of w times a 128-bit approximation of 5^q decide the rounded mantissa. Where the product cannot decide it
 *   (the low word all ones outside the exponents where that is proven harmless) the module does not guess.
 * - The module does not guess either for more than 19 significant digits (zeros past them only scale), an exponent past 10^4, or q outside
 *   [JSON_Q_MIN, JSON_Q_MAX] (the table's range, chosen so every result there is a normal double): the routine answers
 *   NaN, which no JSON number is, and the caller asks the host (`num.fromString`), as it did for every number before.
 *
 * Zero is signed: "-0" and "-0.0e5" are -0. */
import binaryen from "binaryen";

/** The decimal exponents the module decides: 10^-100 .. 10^100 times up to 19 digits stays a normal, finite double. */
export const JSON_Q_MIN = -100, JSON_Q_MAX = 100;

const bitLength = (n: bigint): number => n.toString(2).length;

/** fast_float's power_of_five_128 entries for q in [qmin, qmax]: [high, low] per q, 5^q normalized to 128 bits (truncated
 * for q >= 0; for q < 0 the reciprocal rounded up, as fast_float's generator computes it). */
export const powerOfFive128 = (qmin: number, qmax: number): bigint[] => {
  const out: bigint[] = [];
  const top = 1n << 128n, mask = (1n << 64n) - 1n;
  for (let q = qmin; q <= qmax; q++) {
    let c: bigint;
    if (q < 0) {
      const p5 = 5n ** BigInt(-q);
      const z = bitLength(p5); // the least z with 2^z >= 5^-q (5^-q is never a power of two)
      if (q >= -27) c = (1n << BigInt(z + 127)) / p5 + 1n;
      else {
        c = (1n << BigInt(2 * z + 128)) / p5 + 1n;
        while (c >= top) c >>= 1n;
      }
    } else {
      c = 5n ** BigInt(q);
      while (c < 1n << 127n) c <<= 1n;
      while (c >= top) c >>= 1n;
    }
    if (c >= top || c < 1n << 127n) throw new Error(`json-number: 5^${q} is not normalized`);
    out.push(c >> 64n, c & mask);
  }
  return out;
};

export interface JsonNumberHost {
  m: binaryen.Module;
  /** Defines a module-level helper once under its name (the emitter's defineHelper). */
  defineHelper: (name: string, define: () => void) => string;
  /** The source's value type (the module's string type). */
  srcType: number;
  /** The UTF-16 code unit of `src` at `index` (both expressions). */
  codeAt: (src: number, index: number) => number;
}

/** `$jsonnum.decimal(src, start, end): f64`, the JSON number text src[start, end) as Number() reads it, or NaN where the
 * module leaves it to the host. The text must match the JSON number grammar. */
export const jsonDecimal = (host: JsonNumberHost): string => host.defineHelper("$jsonnum.decimal", () => {
  const { m } = host;
  const i32 = binaryen.i32, i64 = binaryen.i64, f64 = binaryen.f64;
  const k64 = (v: bigint) => m.i64.const(v as unknown as number);
  const el = eiselLemire(host);
  // 10^0 .. 10^22, each an exact double.
  const pow10Heap = (() => { const b = new binaryen.TypeBuilder(1); b.setArrayType(0, f64, binaryen.notPacked, false); return b.buildAndDispose()[0]!; })();
  const pow10Ty = binaryen.getTypeFromHeapType(pow10Heap, false);
  m.addGlobal("$jsonnum.pow10", pow10Ty, false, m.array.new_fixed(pow10Heap, Array.from({ length: 23 }, (_, k) => m.f64.const(Number(`1e${k}`)))));
  const pow10At = (k: number) => m.array.get(m.global.get("$jsonnum.pow10", pow10Ty), k, f64, false);
  // Locals: 0 src, 1 i, 2 end; 3 neg, 4 c, 5 w (u64), 6 nd (significant digits), 7 q, 8 frac, 9 many, 10 ex, 11 exNeg, 12 v.
  const src = () => m.local.get(0, host.srcType), i = () => m.local.get(1, i32), end = () => m.local.get(2, i32);
  const neg = () => m.local.get(3, i32), c = () => m.local.get(4, i32), w = () => m.local.get(5, i64), nd = () => m.local.get(6, i32);
  const q = () => m.local.get(7, i32), frac = () => m.local.get(8, i32), many = () => m.local.get(9, i32), ex = () => m.local.get(10, i32);
  const exNeg = () => m.local.get(11, i32), v = () => m.local.get(12, f64);
  const at = () => host.codeAt(src(), i());
  const more = () => m.i32.lt_s(i(), end());
  const isDigit = () => m.i32.le_u(m.i32.sub(c(), m.i32.const(48)), m.i32.const(9));
  const step = () => m.local.set(1, m.i32.add(i(), m.i32.const(1)));
  // x (never negative) with the text's sign: an exact multiply, so the node appears once (Binaryen's IR is a tree).
  const signed = (x: number) => m.f64.mul(x, m.select(neg(), m.f64.const(-1), m.f64.const(1)));
  m.addFunction("$jsonnum.decimal", binaryen.createType([host.srcType, i32, i32]), f64, [i32, i32, i64, i32, i32, i32, i32, i32, i32, f64], m.block(null, [
    m.if(m.i32.and(more(), m.i32.eq(at(), m.i32.const(0x2d))), m.block(null, [m.local.set(3, m.i32.const(1)), step()])),
    // Digits, with a '.' between the integer and the fraction: leading zeros count only toward the exponent.
    m.block("digits", [m.loop("digit", m.block(null, [
      m.br("digits", m.i32.eqz(more())),
      m.local.set(4, at()),
      m.if(m.i32.eq(c(), m.i32.const(0x2e)), m.block(null, [m.local.set(8, m.i32.const(1)), step(), m.br("digit")])),
      m.br("digits", m.i32.eqz(isDigit())),
      m.if(m.i32.and(m.i64.eqz(w()), m.i32.eq(c(), m.i32.const(48))),
        // A leading zero: in the fraction it moves the point.
        m.if(frac(), m.local.set(7, m.i32.sub(q(), m.i32.const(1)))),
        m.if(m.i32.lt_s(nd(), m.i32.const(19)), m.block(null, [
          m.local.set(5, m.i64.add(m.i64.mul(w(), k64(10n)), m.i64.extend_u(m.i32.sub(c(), m.i32.const(48))))),
          m.local.set(6, m.i32.add(nd(), m.i32.const(1))),
          m.if(frac(), m.local.set(7, m.i32.sub(q(), m.i32.const(1)))),
        ]),
        // Past 19 digits: a zero only scales (in the integer part), any other digit leaves the number to the host.
        m.if(m.i32.eq(c(), m.i32.const(48)), m.if(m.i32.eqz(frac()), m.local.set(7, m.i32.add(q(), m.i32.const(1)))), m.local.set(9, m.i32.const(1))))),
      step(), m.br("digit"),
    ]))]),
    // The exponent, saturated well past any q the module decides.
    m.if(more(), m.block(null, [
      step(),
      m.if(m.i32.and(more(), m.i32.eq(at(), m.i32.const(0x2d))), m.block(null, [m.local.set(11, m.i32.const(1)), step()]),
        m.if(m.i32.and(more(), m.i32.eq(at(), m.i32.const(0x2b))), step())),
      m.loop("exp", m.if(more(), m.block(null, [
        m.local.set(10, m.select(m.i32.gt_s(ex(), m.i32.const(10000)), m.i32.const(100000), m.i32.add(m.i32.mul(ex(), m.i32.const(10)), m.i32.sub(at(), m.i32.const(48))))),
        step(), m.br("exp"),
      ]))),
      m.local.set(7, m.i32.add(q(), m.select(exNeg(), m.i32.sub(m.i32.const(0), ex()), ex()))),
      // An exponent past 10^4 (saturated above) is the host's to weigh against the digits.
      m.if(m.i32.gt_s(ex(), m.i32.const(10000)), m.local.set(9, m.i32.const(1))),
    ])),
    m.if(m.i64.eqz(w()), m.return(signed(m.f64.const(0)))),
    m.if(many(), m.return(m.f64.const(NaN))),
    // Clinger: both operands exact, one rounding.
    m.if(m.i32.and(m.i64.le_u(w(), k64(1n << 53n)), m.i32.le_u(m.i32.add(q(), m.i32.const(22)), m.i32.const(44))), m.block(null, [
      m.local.set(12, m.f64.convert_u.i64(w())),
      m.return(signed(m.if(m.i32.lt_s(q(), m.i32.const(0)),
        m.f64.div(v(), pow10At(m.i32.sub(m.i32.const(0), q()))),
        m.f64.mul(v(), pow10At(q()))))),
    ])),
    m.if(m.i32.or(m.i32.lt_s(q(), m.i32.const(JSON_Q_MIN)), m.i32.gt_s(q(), m.i32.const(JSON_Q_MAX))), m.return(m.f64.const(NaN))),
    // NaN (undecided) keeps its sign out of the caller's way: the caller tests v != v.
    m.return(signed(m.call(el, [w(), q()], f64))),
  ], f64));
});

/** `$jsonnum.el(w, q): f64`, w * 10^q for 0 < w < 10^19 and q in [JSON_Q_MIN, JSON_Q_MAX] (a normal double), or NaN where
 * the 128-bit product does not decide the rounding. fast_float's compute_float, line for line. */
const eiselLemire = (host: JsonNumberHost): string => host.defineHelper("$jsonnum.el", () => {
  const { m } = host;
  const i32 = binaryen.i32, i64 = binaryen.i64, f64 = binaryen.f64;
  const k64 = (v: bigint) => m.i64.const(v as unknown as number);
  const heap = (() => { const b = new binaryen.TypeBuilder(1); b.setArrayType(0, i64, binaryen.notPacked, false); return b.buildAndDispose()[0]!; })();
  const tableTy = binaryen.getTypeFromHeapType(heap, false);
  m.addGlobal("$jsonnum.pow5", tableTy, false, m.array.new_fixed(heap, powerOfFive128(JSON_Q_MIN, JSON_Q_MAX).map(k64)));
  const entry = (k: number) => m.array.get(m.global.get("$jsonnum.pow5", tableTy), k, i64, false);
  // The high 64 bits of the 128-bit product of two u64 values, from 32-bit halves.
  // Fresh nodes per use: an expression shared between two parents is not a tree, and the optimizer then corrupts it.
  const mask32 = () => k64(0xffffffffn), k32 = () => k64(32n);
  const a = () => m.local.get(0, i64), b = () => m.local.get(1, i64), p1 = () => m.local.get(2, i64), p2 = () => m.local.get(3, i64);
  m.addFunction("$jsonnum.mulhi", binaryen.createType([i64, i64]), i64, [i64, i64], m.block(null, [
    m.local.set(2, m.i64.mul(m.i64.and(a(), mask32()), m.i64.shr_u(b(), k32()))), // a_lo * b_hi
    m.local.set(3, m.i64.mul(m.i64.shr_u(a(), k32()), m.i64.and(b(), mask32()))), // a_hi * b_lo
    m.return(m.i64.add(m.i64.add(m.i64.add(
      m.i64.mul(m.i64.shr_u(a(), k32()), m.i64.shr_u(b(), k32())), // a_hi * b_hi
      m.i64.shr_u(p1(), k32())), m.i64.shr_u(p2(), k32())),
      // The carry out of the middle column.
      m.i64.shr_u(m.i64.add(m.i64.add(m.i64.shr_u(m.i64.mul(m.i64.and(a(), mask32()), m.i64.and(b(), mask32())), k32()), m.i64.and(p1(), mask32())), m.i64.and(p2(), mask32())), k32()))),
  ], i64));
  const mulhi = (x: number, y: number) => m.call("$jsonnum.mulhi", [x, y], i64);
  // Locals: 0 w, 1 q; 2 lz, 3 fh, 4 fl, 5 sh, 6 upper, 7 shift, 8 mant, 9 power2, 10 idx (i32).
  const w = () => m.local.get(0, i64), q = () => m.local.get(1, i32), lz = () => m.local.get(2, i64), fh = () => m.local.get(3, i64);
  const fl = () => m.local.get(4, i64), sh = () => m.local.get(5, i64), upper = () => m.local.get(6, i64), shift = () => m.local.get(7, i64);
  const mant = () => m.local.get(8, i64), power2 = () => m.local.get(9, i64), idx = () => m.local.get(10, i32);
  m.addFunction("$jsonnum.el", binaryen.createType([i64, i32]), f64, [i64, i64, i64, i64, i64, i64, i64, i64, i32], m.block(null, [
    m.local.set(2, m.i64.clz(w())),
    m.local.set(0, m.i64.shl(w(), lz())),
    m.local.set(10, m.i32.shl(m.i32.sub(q(), m.i32.const(JSON_Q_MIN)), m.i32.const(1))),
    // compute_product_approximation with 55 bits of precision (mask 0x1ff).
    m.local.set(3, mulhi(w(), entry(idx()))),
    m.local.set(4, m.i64.mul(w(), entry(idx()))),
    m.if(m.i64.eq(m.i64.and(fh(), k64(0x1ffn)), k64(0x1ffn)), m.block(null, [
      m.local.set(5, mulhi(w(), entry(m.i32.add(idx(), m.i32.const(1))))),
      m.local.set(4, m.i64.add(fl(), sh())),
      m.if(m.i64.gt_u(sh(), fl()), m.local.set(3, m.i64.add(fh(), k64(1n)))),
    ])),
    // Not decided by the product (fast_float's former fallback, kept: the host answers instead).
    m.if(m.i32.and(m.i64.eq(fl(), k64(0xffffffffffffffffn)), m.i32.or(m.i32.lt_s(q(), m.i32.const(-27)), m.i32.gt_s(q(), m.i32.const(55)))),
      m.return(m.f64.const(NaN))),
    m.local.set(6, m.i64.shr_u(fh(), k64(63n))),
    m.local.set(7, m.i64.add(upper(), k64(9n))),
    m.local.set(8, m.i64.shr_u(fh(), shift())),
    // power(q) = floor(q * log2(10)) + 63, then the bias.
    m.local.set(9, m.i64.add(m.i64.sub(m.i64.add(m.i64.extend_s(m.i32.add(m.i32.shr_s(m.i32.mul(q(), m.i32.const(217706)), m.i32.const(16)), m.i32.const(63))), upper()), lz()), k64(1023n))),
    // An exact halfway case rounds to even.
    m.if(m.i32.and(m.i32.and(m.i64.le_u(fl(), k64(1n)), m.i32.and(m.i32.ge_s(q(), m.i32.const(-4)), m.i32.le_s(q(), m.i32.const(23)))),
      m.i64.eq(m.i64.and(mant(), k64(3n)), k64(1n))),
      m.if(m.i64.eq(m.i64.shl(mant(), shift()), fh()), m.local.set(8, m.i64.and(mant(), k64(~1n & 0xffffffffffffffffn))))),
    m.local.set(8, m.i64.shr_u(m.i64.add(mant(), m.i64.and(mant(), k64(1n))), k64(1n))),
    m.if(m.i64.ge_u(mant(), k64(2n << 52n)), m.block(null, [m.local.set(8, k64(1n << 52n)), m.local.set(9, m.i64.add(power2(), k64(1n)))])),
    m.return(m.f64.reinterpret(m.i64.or(m.i64.shl(power2(), k64(52n)), m.i64.and(mant(), k64((1n << 52n) - 1n))))),
  ], f64));
});
