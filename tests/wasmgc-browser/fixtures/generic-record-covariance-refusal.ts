// A generic record instantiation (here with a class view) flowing into a wider instantiation of the same generic through a union parameter:
// TS accepts it by covariance; the record layouts differ in member types. It was refused at compile time (never a runtime trap); since
// function adapters convert a dynamic parameter by dynCheck as coerceToExpected does (6dff96d75), `snapshot`'s `unknown` view converts to
// the StoreView it holds by a checked cast (a mismatch is a catchable TypeError, not a trap), and the program runs as Node runs it.
interface ViewOf<V, T = unknown> { readonly schemaId: number; view(bytes: number[]): V | null; snapshot(view: V): T }
interface CodecOf<T> { readonly schemaId: number; encode(value: T): number[] }
interface Profile { level: number }
class StoreView { bytes: number[]; constructor(bytes: number[]) { this.bytes = bytes; } get level(): number { return this.bytes[0]!; } }
function describe(source: CodecOf<Profile> | ViewOf<unknown, Profile>): string {
  if ("encode" in source) return "codec " + source.schemaId;
  const raw = source.view([1, 2]);
  return "view " + (raw === null ? "null" : source.snapshot(raw).level);
}
const viewer: ViewOf<StoreView, Profile> = { schemaId: 9, view: (b: number[]) => new StoreView(b), snapshot: (v: StoreView) => ({ level: v.level }) };
console.log(describe(viewer));
