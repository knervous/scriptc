// @native-only: the engine lane has no island iteration over page-typed values
// for-of over page-typed (TS any, default native lane: host) values that may be compiled
// values or page values: arrays, typed records' array fields, Maps, strings, generators.
import { pageList, pageSet } from "./js-for-of-page-values-helper.js";
const EMPTY: { entries: number[] } = { entries: [1, 2] };
function pick(seed: any, fallback: { entries: number[] }) { let t0; if (seed) { t0 = seed; } else { t0 = fallback; } return t0; }
let out = "";
for (const x of pick(null, EMPTY).entries) out += x;
for (const x of pick(pageList(), EMPTY).entries) out += x;
for (const v of pickAny(pageSet())) out += v;
for (const c of pickAny("ab")) out += c;
function pickAny(v: any) { return v; }
console.log(out);
try { for (const _x of pickAny(5)) out += "?"; } catch (e) { console.log(e instanceof TypeError); }
