// @native-only: engine dyn class facades are incomplete for these conversions
// @native-refuses: native ToPrimitive cannot run a compiled class's own valueOf/toString/Symbol.toStringTag from dynamic code, so it throws instead of answering "[object Object]"
// @expect-native: $2.5 250
// @expect-native: TypeError TypeError TypeError TypeError
// @expect-native: TypeError
// @expect-native: [object Object] [object Object]1 NaN true
// @expect-native: MyErr: mine Error: base
import { convert, plain, errors } from "./audit-class-primitive-helper.js";
class Money { cents: number; constructor(c: number) { this.cents = c; } valueOf(): number { return this.cents; } toString(): string { return `$${this.cents / 100}`; } }
class Sub extends Money { extra = 1; }
class Plain { a = 1; }
class MyErr extends Error { constructor(m: string) { super(m); this.name = "MyErr"; } }
const money = new Money(250);
console.log(money.toString(), money.valueOf());
console.log(convert(money));
console.log(convert(new Sub(5)).split(" ")[0]);
console.log(plain(new Plain()));
console.log(errors(new MyErr("mine"), new Error("base")));
