// @options: {"hostHandles": true}
// @native-only: the rest of an open (index-signature) record is a compiled dynamic object only in the native model
// Object rest over an index-signature record: every entry (declared fields and overflow) the pattern does not name, copied into a fresh object.
type Props = { children?: string; className?: string; [key: string]: unknown };
type Rest = { className?: string; [key: string]: unknown };
const keysOf = (r: { [key: string]: unknown }): string => Object.keys(r).map((k) => k + "=" + String(r[k])).join(",");
function render({ children, className = "", ...props }: Props): string {
  return children + "|" + className + "|" + keysOf(props);
}
console.log(render({ children: "x", id: "i1", count: 5 }));
console.log(render({}));
console.log(render({ className: "c", a: 1, b: "two", c: true }));
const source: Props = { children: "kid", id: "keep", n: 1 };
const { children, ...rest } = source;
const r: Rest = rest;
r["id"] = "changed";
r["extra"] = 9;
console.log(children, source["id"], Object.keys(source).join(","), Object.keys(r).join(","), r["id"], r["extra"], r["n"]);
const { id, ...others } = source;
console.log(id, Object.keys(others).join(","), others["children"], others["n"]);
