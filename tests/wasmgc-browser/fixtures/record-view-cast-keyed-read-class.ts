// @native-any-only: a class instance read through a Record<string, unknown> view needs the class value boxed into native dyn (the other lanes cannot marshal the class)
// A cast to a dynamic-keyed record type over a class instance: the keyed read goes through the dyn form of the instance.
class Gear { power = 7; label = "g"; }
const readAny = (g: Gear | null, key: string): unknown => (g as unknown as Record<string, unknown> | null)?.[key];
console.log(readAny(new Gear(), "power"), readAny(new Gear(), "label"), readAny(new Gear(), "nope"), readAny(null, "power"));
