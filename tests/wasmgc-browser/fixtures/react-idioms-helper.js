// react-dom idioms: each function is called from the driver with the argument types that made react's instantiations refuse.
function fail(x) { throw new Error("hydration " + x); }
export function throwVoid(x) {
  if (x === null) throw fail(x);
  return x;
}
export function callNullable(action, data) {
  return null === action ? function noop() { return 0; } : function () { return action(data); };
}
export function styles(node, styles, prev) {
  var out = [];
  if (null != prev) {
    for (var name in prev) !prev.hasOwnProperty(name) || (null != styles && styles.hasOwnProperty(name)) || out.push(name);
  }
  return out;
}
export function bailout(current, wip, lanes) {
  wip.updateQueue = current.updateQueue;
  wip.flags &= -2053;
  current.lanes &= ~lanes;
}
export function mapChildren(children, func, context) {
  if (null == children) return children;
  var result = [], count = 0;
  [children].forEach(function (child) { result.push(func.call(context, child, count++)); });
  return result;
}
export function preload(link) {
  link._p = new Promise(function (resolve, reject) {
    link.onload = resolve;
    link.onerror = reject;
  });
  return link;
}
export function updateForward(current, wip, lanes) {
  if (null !== current) return bailout(current, wip, lanes), 1;
  return 2;
}
export function setProp(domElement, value, prevValue) {
  return styles(domElement, value, prevValue);
}
export function startHost(formFiber, pending, action, formData) {
  return pending.run(null === action ? function noop() { return "noop"; } : function () { return action(formData); });
}
