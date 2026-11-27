// @native-any-only: the standard library's `Function` type (any callable) as a parameter, array element and field: reads and calls go through the dynamic representation.
class Comp { isReactComponent = {}; render(): number { return 1; } get answer(): number { return 42; } }
function plain(): number { return 2; }
function shouldConstruct(Component: Function): boolean {
  const prototype = Component.prototype;
  return !!(prototype && prototype.isReactComponent);
}
const hooks: Array<Function> = [];
const holder: { cb: Function | null } = { cb: null };
hooks.push(plain, () => 3);
holder.cb = plain;
console.log(shouldConstruct(plain), shouldConstruct(Comp), hooks.length, typeof hooks[0], typeof holder.cb, holder.cb === plain);
console.log((hooks[1] as () => number)(), (holder.cb as () => number)());
