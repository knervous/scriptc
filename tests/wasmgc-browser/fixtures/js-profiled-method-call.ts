// Method calls a site profile records as monomorphic on one function literal (React's
// `H.useContext(c)`): on a plain-object receiver whose method is that literal's closure the site
// calls the literal directly (receiver as `this`, missing arguments undefined, extras seen by
// `arguments`); a capturing literal is recognized by its environment (unless scope-env shares it); any other method value
// (a swapped method, another closure of the same literal is still a hit), or receiver kind
// (array, other object, undefined), takes the generic path with V8's TypeErrors.
// js-profiled-method-call.profile.json: hand-made, one monomorphic call site per method call in the helper.
// @options: {"experimentalJsSpecialize":"profile","experimentalJsSpecializeProfile":"fixtures/js-profiled-method-call.profile.json"}
// @native-only: profile guards are a native-dyn compile option
// @hits(native,native-any): ^\$hit\.pgo\.invoke$
import { dispA, dispB, call, callCap, callExtra, callMissing, swap, plain, otherRead, attempt } from "./js-profiled-method-call-helper.js";
const out: string[] = [];
const tryIt = (f: () => any): void => { out.push(attempt(f)); };
for (let i = 0; i < 3; i++) { tryIt(() => call(dispA, i)); tryIt(() => call(dispB, "b" + i)); tryIt(() => callCap(dispA, i)); tryIt(() => callCap(dispB, i)); }
tryIt(() => callExtra(dispA)); tryIt(() => callMissing(dispB)); tryIt(() => plain(7));
tryIt(() => call({ tag: "Q", read: dispA.cap }, 1));
tryIt(() => call([1, 2], 1)); tryIt(() => call(undefined, 1)); tryIt(() => call({}, 1));
tryIt(() => call(otherRead(), 2));
swap(dispA); tryIt(() => call(dispA, 9)); tryIt(() => call(dispB, 9));
console.log(out.join("\n"));
