export function run() {
  const cfg = { key: "k1", ref: "r1", className: "box", "data-id": 7, __self: "s", __source: "src", custom: "c" };
  const picked = [];
  for (const name in cfg) {
    if (name !== "key" && name !== "__self" && name !== "__source" && "ref" !== name) picked.push(name);
  }
  console.log(picked.join(","));
  // strings built at run time equal literals; atoms may or may not be cached on either side
  const built = "cla" + "ssName";
  const anyBuilt = built;
  console.log(anyBuilt === "className", built === "className", "className" === anyBuilt, anyBuilt === "classname");
  const a = "row q-rare", b = ["row", "q-rare"].join(" "), c = "row q-epic";
  console.log(a === b, a === c, a !== b, b === "row q-rare", c === "row q-rare");
  const keys = Object.keys(cfg);
  let same = 0;
  for (let i = 0; i < keys.length; i++) for (let j = 0; j < keys.length; j++) if (keys[i] === keys[j]) same++;
  console.log(same === keys.length);
  for (const k in cfg) { const copy = String(k); if (copy === k) same++; }
  console.log(same);
  // members of string primitives
  const s = "hello";
  console.log(s.length, s.defaultProps, s.nope, s.toUpperCase());
  // dynamic record check on a props-like object
  function row(props) { return props.row + ":" + props.label; }
  const dynProps = { row: 5, label: "x" };
  console.log(row(dynProps));
}
