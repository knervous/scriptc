function t(label, f) { try { return label + "=" + String(f()); } catch (e) { return label + "!" + String(e.message).slice(0, 70); } }
var N = Number, S = String;
export function run(num, str) {
  return [
    t("isInteger-value", () => { var f = N.isInteger; return [f(5), f(5.5), f("5"), f(NaN)]; }), t("isFinite", () => [N.isFinite(1 / 0), N.isFinite(2), N.isFinite("2")]), t("isNaN", () => [N.isNaN(NaN), N.isNaN("x"), N.isNaN(1)]),
    t("isSafe", () => [N.isSafeInteger(2 ** 53), N.isSafeInteger(2 ** 53 - 1), N.isSafeInteger(1.5)]), t("parseFloat", () => N.parseFloat("3.5x")), t("parseInt", () => N.parseInt("ff", 16)),
    t("EPSILON", () => N.EPSILON), t("MAX_SAFE", () => N.MAX_SAFE_INTEGER), t("MIN_SAFE", () => N.MIN_SAFE_INTEGER), t("MAX_VALUE", () => N.MAX_VALUE), t("MIN_VALUE", () => N.MIN_VALUE),
    t("INF", () => N.POSITIVE_INFINITY + "," + N.NEGATIVE_INFINITY + "," + N.NaN),
    t("fromCharCode", () => S.fromCharCode(72, 105)), t("fromCodePoint", () => S.fromCodePoint(128512)), t("raw-call", () => S.raw({ raw: ["x", "y", "z"] }, 1, 2)), t("raw-short", () => S.raw({ raw: ["x", "y", "z"] }, 1)),
    t("typeof", () => typeof N.isInteger + typeof S.raw + typeof S.fromCharCode), t("name", () => N.isInteger.name + S.raw.name + S.fromCharCode.name),
    t("keys", () => Object.keys(N).length + "," + Object.keys(S).length), t("ctor", () => N("12") + 1 + S(5) + (N === num.constructor) + (S === str.constructor)),
  ].join("\n");
}
