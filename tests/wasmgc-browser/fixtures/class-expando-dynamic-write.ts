// @known-defect(engine): the engine lane's dyn class key listing cannot marshal the class value it walks (%dyn.class.keys)
// @known-defect-expect: compile: marshalling classval to JavaScript
// A run-time key written onto a class instance through an `object` view (React's synthetic event copying its
// Interface): an own expando property after the declared fields. Same output as Node.
type PropertyBag = { [key: string]: unknown };
function writeProperty(target: object, key: string, value: unknown): void { (target as PropertyBag)[key] = value; }
function readProperty(target: object, key: string): unknown { return (target as PropertyBag)[key]; }
class Signal { type = "click"; }
const signal = new Signal();
writeProperty(signal, "detail", 3);
console.log(readProperty(signal, "detail"), Object.keys(signal).join(","));
export {};
