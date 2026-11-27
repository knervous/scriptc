// Property descriptors of sealed and frozen untyped arrays reflect their
// integrity level (their page form knew nothing of it).
export function run() {
  const d = (a, k) => { const x = Object.getOwnPropertyDescriptor(a, k); return x ? [x.value, x.writable, x.enumerable, x.configurable].join("/") : "none"; };
  const plain = JSON.parse('[1,2]'), sealed = JSON.parse('[3,4]'), frozen = JSON.parse('[5,6]');
  Object.seal(sealed); Object.freeze(frozen);
  return [d(plain, "0"), d(plain, "length"), d(plain, "5"), d(sealed, "1"), d(sealed, "length"), d(frozen, "0"), d(frozen, "length"), d(frozen, "x")].join(" ");
}
