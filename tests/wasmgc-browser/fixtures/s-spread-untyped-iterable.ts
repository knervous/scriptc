// @options: {"hostHandles": true}
// @native-any-only: spread arguments over an untyped iterable need native any (plain native refuses them loudly, SC1090 at the call); the engine lane lowers an island spread through Array.from, which turns a non-iterable object into []
// Array spread / Array.from over untyped (any) iterables run the iteration protocol into a compiled array.
const byCorpse = new Map();
byCorpse.set(1, { name: "a" });
byCorpse.set(2, { name: "b" });
let t4;
t4 = [...byCorpse.entries()];
console.log(JSON.stringify(t4), Array.isArray(t4), t4.length);
const s = new Set([3, 4]);
let t5: any;
t5 = [0, ...s, 9, ...byCorpse.keys(), ..."hi"];
console.log(JSON.stringify(t5));
class Two {
  [Symbol.iterator]() {
    let i = 0;
    return { next: () => (i < 2 ? { value: "xy"[i++], done: false } : { value: undefined, done: true }) };
  }
}
const it: any = new Two();
let t7: any;
t7 = [...it, ...[7, , 8]];
console.log(t7.length, 1 in t7, JSON.stringify(t7));
try { let t8: any; const nope: any = {}; t8 = [...nope]; console.log(t8); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
try { let t9: any; const nope: any = undefined; t9 = [...nope]; console.log(t9); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
import { callSpread, callSpreadPre, maxOf, viaMethod, newSpread, literal, isArr, ArrayAlias } from './s-spread-untyped-iterable-helper.js';
const pair: any = new Map([[1, 2]]);
console.log(callSpread(new Set([4, 5, 6])), callSpread("xyz"), callSpread([7, 8, 9]), callSpreadPre(new Set([2, 3])), callSpread(byCorpse.keys()));
console.log(maxOf(new Set([3, 9, 4])), maxOf([5, 1]), viaMethod([0], new Set([1, 2])), newSpread(ArrayAlias, [3]).length, literal(pair).length);
console.log(isArr([]), isArr(new Set()), isArr("ab"), isArr(undefined), isArr(t4), isArr(literal("q")));
try { callSpread(undefined); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
