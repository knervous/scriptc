// @native-only: Symbol() values are native dyn operations
// The counterpart of brand-keyed-interface-record: a symbol key whose constant
// HAS a runtime value is readable and writable, so the interface keeps the
// checked-dynamic shape (only ambient `declare const k: unique symbol` keys are
// type-only brands).
declare const typeOnly: unique symbol;
const realKey: unique symbol = Symbol("real");
interface Tagged { readonly [typeOnly]?: true; [realKey]: string; n: number }
const tagged: Tagged = { [realKey]: "tag", n: 1 };
tagged[realKey] = tagged[realKey] + "!";
console.log(tagged[realKey], tagged.n, JSON.stringify(tagged));
export {};
