// @native-any-only: the web host reads a page object's members through the page; the native host has its own object model
// A page object (a class instance with prototype methods: URLSearchParams, the platform's HID/Navigator members) viewed through an interface:
// `x ?? null` into `I | null` keeps it page-backed (no data copy), and its methods run with the page object as `this`.
interface Params { get(key: string): string | null; has(key: string): boolean; toString(): string }
interface Wrapper extends EventTarget { get(key: string): string | null }
const make = (): any => new URLSearchParams("a=1&b=2");
const raw: any = make();
const direct: Params = raw;
console.log(direct.get("a"), direct.has("b"), direct.has("z"));
const maybe: Params | null = raw ?? null;
console.log(maybe !== null, maybe!.get("b"), maybe!.has("a"));
const viaCast = (raw ?? null) as Params | null;
console.log(viaCast!.get("a"));
const wrapped: Wrapper | null = raw ?? null;
console.log(wrapped!.get("a"));
const missing: any = JSON.parse("[null]")[0];
const none: Params | null = missing ?? null;
console.log(none);
