// A page function that takes props as an untyped page object (React's jsx
// runtime shape) and reports what it received.
export function jsx(type, props) {
  const keys = Object.keys(props).sort();
  const kids = Array.isArray(props.children) ? props.children.length : props.children === undefined ? 0 : 1;
  return `${typeof type === "function" ? type.name || "fn" : type}:${keys.join(",")}:${kids}:${props.title ?? ""}`;
}
