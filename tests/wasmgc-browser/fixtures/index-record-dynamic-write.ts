// @known-defect(engine): the engine lane writes through the record's page view (adopting it), and the static Object.keys misses the page object's keys (as reflect-set-index-record)
// @known-defect-expect: stdout: eventPhase 1 2
// Writing a run-time key into an index-signature record through an `object` view (React's writeProperty, filling
// an event Interface): the key lands in the record's own entries, readable and enumerable from the typed side.
// Same output as Node.
type PropertyBag = { [key: string]: unknown };
function writeProperty(target: object, key: string, value: unknown): void { (target as PropertyBag)[key] = value; }
function readProperty(target: object, key: string): unknown { return (target as PropertyBag)[key]; }
type Interface = { [name: string]: number };
const base: Interface = { eventPhase: 0 };
writeProperty(base, "bubbles", 1);
writeProperty(base, "cancelable", 2);
console.log(Object.keys(base).join(","), base["bubbles"], readProperty(base, "cancelable"));
export {};
