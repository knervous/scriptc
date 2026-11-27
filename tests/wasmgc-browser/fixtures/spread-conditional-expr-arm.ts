// A conditional spread whose taken arm is an expression: `c ? {} : build()`.
// The expression evaluates only when its arm is taken.
interface Attrs {
  role?: string;
  tab?: number;
  label: string;
}
let built = 0;
const show = (a: Attrs): string => `label=${a.label} role=${a.role} tab=${a.tab}`;
function build(tag: string): { role: string; tab: number } {
  built++;
  return { role: tag, tab: built };
}
function props(hot: boolean, tag: string): Attrs {
  return { label: "item", ...(hot ? {} : build(tag)) };
}
function props2(hot: boolean, tag: string): Attrs {
  return { label: "x", role: "base", ...(hot ? build(tag) : undefined), tab: 0 };
}
console.log(show(props(true, "a")), built);
console.log(show(props(false, "b")), built);
console.log(show(props2(true, "c")), built);
console.log(show(props2(false, "d")), built);
