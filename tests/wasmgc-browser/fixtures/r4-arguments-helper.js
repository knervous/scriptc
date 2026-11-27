// `arguments` beyond the declared parameters (React's createElement shape).
export function children(type, config, children) {
  var n = arguments.length - 2, out = [];
  if (n === 1) out.push(children);
  else for (var i = 0; i < n; i++) out[i] = arguments[i + 2];
  return type + "|" + (config === null) + "|" + out.join(",") + "|" + arguments.length;
}
export function childArray(type, config, children) {
  var childrenLength = arguments.length - 2, props = { config: config };
  if (1 === childrenLength) props.children = children;
  else if (1 < childrenLength) {
    for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++) childArray[i] = arguments[i + 2];
    props.children = childArray;
  }
  return type + ":" + (Array.isArray(props.children) ? props.children.length + "/" + props.children.join(",") : String(props.children));
}
var isArrayImpl = Array.isArray;
function element(type, config, children) {
  var props = { config: config }, childrenLength = arguments.length - 2;
  if (1 === childrenLength) props.children = children;
  else if (1 < childrenLength) { for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++) childArray[i] = arguments[i + 2]; props.children = childArray; }
  return { type: type, props: props };
}
function describe(el) {
  if (typeof el !== "object" || el === null) return String(el);
  var kids = el.props.children, out = el.type + "(";
  if (isArrayImpl(kids)) { for (var i = 0; i < kids.length; i++) out += (i ? "," : "") + describe(kids[i]); }
  else if (kids !== undefined) out += describe(kids);
  return out + ")";
}
export function tree() {
  return describe(element("div", null, element("input", null), element("ul", null, element("li", null, "a"), element("li", null, "b")), element("p", null, "x")));
}
export function makeElement() { return element; }
export function describeIt(el) { return describe(el); }
export var api = {};
api.createEl = function (type, config, children) {
  var props = { config: config }, childrenLength = arguments.length - 2;
  if (1 === childrenLength) props.children = children;
  else if (1 < childrenLength) { for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++) childArray[i] = arguments[i + 2]; props.children = childArray; }
  return { type: type, props: props };
};
export const createEl2 = api.createEl;
