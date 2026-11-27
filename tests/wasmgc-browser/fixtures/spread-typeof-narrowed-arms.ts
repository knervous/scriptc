// @options: {"interfaceClassArms": true}
// Spreading a `number | Shape` narrowed by typeof to the structural arm: Shape also accepts a
// wider record by reference, so the narrowed value is a union of record arms, and the number arm
// is dropped before the copy.
interface Shape { readonly stride: number; readonly offset?: number; readonly copy: number }
type Delta = { stride: number; copy: number; rows: number };
function normalize(shapeOrStride: number | Shape) {
  const shape = typeof shapeOrStride === "number"
    ? { stride: shapeOrStride, offset: 0, copy: shapeOrStride }
    : { offset: 0, ...shapeOrStride };
  return shape.stride + ":" + shape.copy + ":" + shape.offset;
}
const delta: Delta = { stride: 6, copy: 3, rows: 9 };
console.log(normalize(4));
console.log(normalize({ stride: 8, copy: 2, offset: 1 }));
console.log(normalize(delta));
export {};
