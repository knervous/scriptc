// @native-any-only: an any-typed argument stays untyped only in the native any model
// new Float32Array(x) where x is `any` (gltf-parser.ts computeNodeWorldMatrix(json: any) `new F32(node.matrix)`):
// an array (parsed JSON, or built in compiled code) copies each element through ToNumber (strings and
// booleans convert, holes and undefined read NaN); undefined and null give an empty array.
const json: any = JSON.parse('{"nodes":[{"matrix":[1,0,0,0,0,1,0,0,0,0,1,0,5,6,7,1]},{"name":"none"},{"matrix":["2.5",true,null]}]}');
function world(node: any): string {
  if (!node.matrix) return "identity";
  const m = new Float32Array(node.matrix);
  return `${m.length}:${Array.from(m).join(",")}`;
}
for (const node of json.nodes) console.log(world(node));
const built: any = [3, "4", undefined, 1e40, -1.5];
console.log(Array.from(new Float32Array(built)).join(","), Array.from(new Int8Array(built)).join(","), Array.from(new Uint8ClampedArray(built)).join(","));
const nothing: any = undefined, empty: any = null;
console.log(new Float64Array(nothing).length, new Float64Array(empty).length);
