// @options: {"interfaceClassArms": true}
// @native-only: the engine dyn model refuses accessor literals that satisfy a data property
// Same-name getters with different return types through one interface slot.
interface Value { x: number | string; }
const first: Value = { get x() { return 7; } };
const second: Value = { get x() { return "two"; } };
const third: Value = { x: true ? 3 : "s" };
console.log(first.x, second.x, third.x);
export {};
