// A resolver returning `{ _state: texture }` through a `(...) => Resolved` slot whose `_state` is unknown: the function
// adapter reshapes the result record, and the field boxes the texture by reference, as a direct `unknown` slot does.
// A checked read back recovers the same object, so identity tests and Set/WeakMap registries keep answering
// (a renderer's storage-texture bindings: a copied texture failed its registry and engine checks).
declare const textureBrand: unique symbol;
interface Engine {
  readonly name: string;
  epoch: number;
}
interface Texture {
  readonly [textureBrand]?: true;
  readonly width: number;
  readonly _engine: Engine;
  _destroyed: boolean;
}
interface Resolved {
  readonly _state: unknown;
  readonly _dynamic?: { readonly _alignment: number };
}
type Resolve = (engine: Engine, resource: unknown) => Resolved;

const engine: Engine = { name: "main", epoch: 0 };
const a: Texture = { width: 64, _engine: engine, _destroyed: false };
const b: Texture = { width: 128, _engine: engine, _destroyed: false };
const live = new Set<Texture>([a, b]);
const labels = new WeakMap<Texture, string>([[a, "A"], [b, "B"]]);

function resolveTexture(e: Engine, input: unknown) {
  const texture = input as Texture;
  if (texture._engine !== e || !live.has(texture)) throw new Error("resolve: not a live texture");
  return { _state: texture };
}
function resolveWithOffset(_e: Engine, input: unknown) {
  const texture = input as Texture;
  return { _state: texture, _dynamic: { _alignment: texture.width * 2 } };
}
function check(e: Engine, state: unknown): string {
  const texture = state as Texture;
  return `${texture === a || texture === b} ${texture._engine === e} ${texture._destroyed} ${live.has(texture)} ${labels.get(texture)}`;
}

const resolvers: Resolve[] = [resolveTexture, resolveWithOffset];
for (let i = 0; i < 2; i++) {
  const texture = i === 0 ? a : b;
  const resolved = resolvers[0]!(engine, texture);
  console.log(resolved._state === texture, check(engine, resolved._state));
  const offset = resolvers[1]!(engine, texture);
  console.log(offset._state === texture, offset._dynamic?._alignment, check(engine, offset._state));
}
// Writes through the original show through the boxed state, and the reverse.
const state = resolvers[0]!(engine, a)._state;
a._destroyed = true;
console.log(check(engine, state));
(state as Texture)._destroyed = false;
console.log(a._destroyed, check(engine, state));
live.delete(a);
console.log(check(engine, state));
try {
  resolvers[0]!(engine, a);
} catch (error) {
  console.log(String(error));
}
