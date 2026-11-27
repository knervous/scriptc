// @native-any-only: untyped calls through an any-typed binding and prototype reflection over a method taking a callback that returns a record with accessors
// A method whose callback parameter returns a record with get/set accessors: untyped code hands over a function that returns the typed record itself.
interface Binding { block: number; get count(): number; get enabled(): boolean; set enabled(v: boolean) }
class Fog {
  private source: (() => Binding | null) | null = null;
  setSource(provider: () => Binding | null): void { this.source = provider; }
  read(): string { const b = this.source ? this.source() : null; return b === null ? "none" : b.block + ":" + b.count + ":" + b.enabled; }
}
let on = true;
const binding: Binding = { block: 7, get count() { return 3; }, get enabled() { return on; }, set enabled(v: boolean) { on = v; } };
const fog = new Fog();
const loose: any = fog;
console.log(fog.read());
loose.setSource(() => binding);
console.log(fog.read());
on = false;
console.log(fog.read());
loose.setSource(() => null);
console.log(fog.read());
console.log(Object.getOwnPropertyNames(Fog.prototype).join(","));
