// @refuse: unbounded generic instantiation
// Polymorphic recursion: each instance of `nest` requests the next from inside its own body (T, T[], T[][], ...), a
// chain that never closes. Refused at compile time by the instantiation-depth bound, never a hang.
function nest<T>(value: T, depth: number): number {
  if (depth === 0) return 0;
  return 1 + nest([value], depth - 1);
}
console.log(nest(1, 3));
