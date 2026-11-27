// experimentalOpaquePageExpandos: a compiled object or array stored on a
// page object without a facade yet is stored as an opaque reference. The
// key behaves as before (in, enumeration, delete, a frozen node's
// TypeError) and compiled code gets the same value back, from its own reads
// and from the page handing it back; only what the page sees differs.
var randomKey = Math.random().toString(36).slice(2),
  kFiber = "__reactFiber$" + randomKey,
  kProps = "__reactProps$" + randomKey,
  kEvents = "__reactEvents$" + randomKey,
  kListeners = "__reactListeners$" + randomKey,
  kHandles = "__reactHandles$" + randomKey;
export function detach(node) {
  delete node[kFiber];
  delete node[kProps];
  delete node[kEvents];
  delete node[kListeners];
  delete node[kHandles];
}
export function run(h) {
  const out = [];
  const node = h.auditExpandoNode();
  const fiber = { tag: 5, child: null }, props = { tag: "p" };
  node[kFiber] = fiber;
  node[kProps] = props;
  out.push(node[kFiber] === fiber, node[kProps] === props, node[kFiber] === node[kFiber]);
  // The page sees an opaque value: an object with no properties.
  out.push(h.auditExpandoRead(node, kFiber));
  // Handed back by the page, it is the compiled value itself.
  out.push(h.auditExpandoPass(node, kFiber, (v) => v === fiber));
  fiber.tag = 6;
  out.push(node[kFiber].tag);
  // Another crossing makes a facade, which is a different page value.
  h.auditKeep(fiber);
  out.push(h.auditExpandoKept(node, kFiber));
  // A value that already crossed is stored as the facade the page holds.
  const seen = { tag: 7 };
  h.auditKeep(seen);
  node[kListeners] = seen;
  out.push(h.auditExpandoKept(node, kListeners), node[kListeners] === seen, h.auditExpandoRead(node, kListeners));
  const list = Array(2); list[0] = 1; list[1] = "two";
  node[kEvents] = list;
  out.push(node[kEvents] === list, node[kEvents].length, h.auditExpandoPass(node, kEvents, (v) => v === list));
  out.push(kFiber in node, Object.keys(node).length);
  detach(node);
  out.push(kFiber in node, kProps in node, kEvents in node, Object.keys(node).join("+"));
  const frozen = h.auditExpandoNode();
  h.auditFreeze(frozen);
  try { frozen[kFiber] = { tag: 8 }; out.push("stored"); } catch (e) { out.push(e instanceof TypeError); }
  out.push(kFiber in frozen);
  return out.join(" ");
}
// A typed record (React's props from typed code) is stored opaque too.
export function runTyped(h, props) {
  const node = h.auditExpandoNode();
  node[kProps] = props;
  return [node[kProps] === props, h.auditExpandoRead(node, kProps), h.auditExpandoPass(node, kProps, (v) => v === props), node[kProps].title].join(" ");
}
