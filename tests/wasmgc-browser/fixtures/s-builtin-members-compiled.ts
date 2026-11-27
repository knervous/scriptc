// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled values and their inherited builtin members meet the page only in the native any model
// The builtin prototype members compiled values inherit (read as values, stored, called later with a receiver) are compiled
// functions on the native host: no page prototype is asked (js.builtinMethod). Array/Map/Set @@iterator and values/entries are the
// spec's shared functions.
import { protoFacts } from './s-builtin-members-compiled-helper.js';
const arr: any = [3, 1, 2];
const m: any = new Map([[1, "a"], [2, "b"]]);
const s: any = new Set([7, 8]);
const push = arr.push, slice = arr.slice, map = arr.map, join = arr.join;
console.log(typeof push, typeof slice, typeof map, push.name, push.length, slice.length);
console.log(push.call(arr, 4), slice.call(arr, 1).join(), map.call(arr, (x: number) => x * 2).join(), join.call(arr, "-"));
const bound = arr.indexOf.bind(arr);
console.log(bound(2), arr.includes === arr.includes, arr.values === arr[Symbol.iterator], arr.keys === arr.values);
console.log(m[Symbol.iterator] === m.entries, s[Symbol.iterator] === s.values, s.keys === s.values, m.keys === m.values);
console.log([...arr[Symbol.iterator]()].join(), [...m[Symbol.iterator]()].join("|"), [...s[Symbol.iterator]()].join(), [...m.keys()].join(), [...arr.entries()].join("|"));
const it = arr[Symbol.iterator]();
console.log(it.next().value, it.next().value, typeof it[Symbol.iterator], it[Symbol.iterator]() === it);
const get = m.get, has = s.has, add = s.add;
console.log(get.call(m, 2), has.call(s, 8), has.call(s, 9), add.call(s, 9) === s, s.size);
try { get.call(arr, 1); } catch (e) { console.log(e instanceof TypeError); }
const fixed = (5 as any).toFixed, num: any = 3.14159;
console.log(typeof fixed, fixed.call(num, 2), num.toFixed(1), (true as any).toString === (false as any).toString);
const own = ({} as any).hasOwnProperty, valueOf = ({} as any).valueOf, pie = ({} as any).propertyIsEnumerable;
const o: any = { a: 1 };
console.log(own.call(o, "a"), valueOf.call(o) === o, pie.call(o, "a"), pie.call(o, "b"));
const str: any = "a😀", si = str[Symbol.iterator];
console.log(typeof si, si.name, [...si.call(str)].join("|"), si.call(str).next().value);
console.log("map" in arr, "nope" in arr);
console.log(protoFacts(arr, slice).join());
const fnv: any = function add(a: number, b: number) { return a + b; };
const fcall = fnv.call, fapply = fnv.apply, fbind = fnv.bind;
console.log(typeof fcall, typeof fapply, fcall.call(fnv, null, 1, 2), fapply.call(fnv, null, [3, 4]), fbind.call(fnv, null, 5)(6), fcall.name, fapply.length);
const prom: any = Promise.resolve(7);
const then = prom.then;
console.log(typeof then, then.name, typeof prom.catch, typeof prom.finally);
then.call(prom, (v: number) => console.log("then", v));
const bs: any = true, tostr = bs.toString;
console.log(typeof tostr, tostr.call(false), (12.5 as any).toString.call(255, 16));
