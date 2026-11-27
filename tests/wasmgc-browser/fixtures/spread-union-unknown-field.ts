// @options: {"interfaceClassArms": true}
// Spreading a `Partial<P> | undefined` whose union also holds a class arm into a
// literal whose declared type has an optional `unknown` field: the absent arm leaves
// that field unset (undefined), the held arm copies its own data fields.
interface Props { a?: number; meta?: unknown; label?: string }
class Layer { a = 1; meta: unknown = { k: 1 }; label = "layer"; }
function build(layer: Partial<Props> | undefined): Props {
  return { ...layer, label: layer?.label ?? "none" } as Props;
}
console.log(JSON.stringify(build(undefined)));
console.log(JSON.stringify(build({ a: 5 })));
console.log(JSON.stringify(build({ meta: [1, 2], label: "x" })));
console.log(JSON.stringify(build(new Layer())));
export {};
