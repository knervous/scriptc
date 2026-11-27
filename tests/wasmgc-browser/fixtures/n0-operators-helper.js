// Untyped operators (compiled as JavaScript).
export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
export function mul(a, b) { return a * b; }
export function div(a, b) { return a / b; }
export function mod(a, b) { return a % b; }
export function pow(a, b) { return a ** b; }
export function band(a, b) { return a & b; }
export function bor(a, b) { return a | b; }
export function bxor(a, b) { return a ^ b; }
export function shl(a, b) { return a << b; }
export function shr(a, b) { return a >> b; }
export function ushr(a, b) { return a >>> b; }
export function lt(a, b) { return a < b; }
export function ge(a, b) { return a >= b; }
export function inc(a) { let x = a; x++; return x; }
export function dec(a) { let x = a; x--; return x; }
export function flags(f) { f |= 4; f &= ~1; return f; }
export function obj() { return { n: 1 }; }
export function grid(vals) {
  let out = "";
  for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals.length; j++) {
    const a = vals[i], b = vals[j];
    out = out + add(a, b) + "," + sub(a, b) + "," + mul(a, b) + "," + div(a, b) + "," + mod(a, b) + "," + band(a, b) + "," + bor(a, b) + "," + bxor(a, b) + "," + shl(a, b) + "," + shr(a, b) + "," + ushr(a, b) + " ";
  }
  return out;
}
export function extras() {
  return "" + pow(2, 10) + " " + pow("2", 0.5) + " " + lt(1, 2) + " " + lt("b", "a") + " " + lt("10", "9") + " " + lt(10, "9") + " " + ge(null, 0) + " " + lt(undefined, 1) +
    " | " + inc(1) + " " + inc(-2) + " " + dec(0.5) + " " + flags(3) + " " + flags(-1) +
    " | " + add("a", obj()) + " " + add(1, null) + " " + add(true, true) + " " + add([1, 2], 3);
}
