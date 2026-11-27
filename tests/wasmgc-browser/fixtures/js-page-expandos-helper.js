// Compiled values stored on page objects under computed keys, as React-DOM
// does on DOM nodes (precacheFiberNode, updateFiberProps,
// detachDeletedInstance): the page reads a live facade with one identity,
// compiled reads get the value back, and the keys behave as plain
// properties (in, enumeration, delete, a frozen node's TypeError).
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
// Two deletes with literal keys, then one whose key is not stable.
let moving = "a";
export function detachLiterals(node) {
  delete node["x"];
  delete node.y;
  delete node[moving];
}
export function run(h) {
  const out = [];
  const node = h.auditExpandoNode();
  const fiber = { tag: 5, child: null }, props = { tag: "p", children: [1, 2] };
  node[kFiber] = fiber;
  node[kProps] = props;
  out.push(node[kFiber] === fiber, node[kProps] === props, node[kFiber] === node[kFiber]);
  out.push(h.auditExpandoRead(node, kFiber));
  fiber.tag = 6;
  out.push(h.auditExpandoRead(node, kFiber));
  h.auditKeep(fiber);
  out.push(h.auditExpandoKept(node, kFiber));
  const list = [1, 2, 3];
  node[kEvents] = list;
  out.push(node[kEvents] === list, h.auditExpandoRead(node, kEvents));
  // A value that already crossed is stored as the facade the page holds.
  const seen = { tag: 7 };
  h.auditKeep(seen);
  node[kListeners] = seen;
  out.push(h.auditExpandoKept(node, kListeners), node[kListeners] === seen);
  // Primitives and page values stored under the same keys.
  node[kHandles] = "h";
  out.push(node[kHandles], kFiber in node, Object.keys(node).length);
  detach(node);
  out.push(kFiber in node, kProps in node, kEvents in node, kHandles in node, Object.keys(node).join("+"));
  // A strict failure in the middle of a run: earlier keys are gone, later ones stay.
  const pinned = h.auditExpandoNode();
  pinned[kFiber] = fiber; pinned[kProps] = props; pinned[kListeners] = 1; pinned[kHandles] = 2;
  h.auditExpandoPin(pinned, kEvents);
  try { detach(pinned); out.push("no throw"); } catch (e) { out.push(e instanceof TypeError); }
  out.push(kFiber in pinned, kProps in pinned, kEvents in pinned, kListeners in pinned, kHandles in pinned);
  // The same statements on a compiled object.
  const own = { [kFiber]: 1, [kProps]: 2, x: 3 };
  detach(own);
  out.push(Object.keys(own).join("+"));
  const lit = h.auditExpandoNode();
  lit.x = 1; lit.y = 2; lit.a = 3; lit.b = 4;
  detachLiterals(lit); moving = "b"; detachLiterals(lit);
  out.push(Object.keys(lit).join("+"));
  // A frozen node: the store throws (strict mode) and nothing is added.
  const frozen = h.auditExpandoNode();
  h.auditFreeze(frozen);
  const late = { tag: 8 };
  try { frozen[kFiber] = late; out.push("stored"); } catch (e) { out.push(e instanceof TypeError); }
  out.push(kFiber in frozen, Object.keys(frozen).join("+"));
  h.auditKeep(late);
  out.push(h.auditExpandoKept(frozen, kFiber));
  // Setters that see the facade before the store returns keep one identity:
  // a callback crossing it back, and a setter that keeps it and throws.
  const hooks = h.auditExpandoHooks((v) => { h.auditKeep(v); });
  const hv = { tag: 9 };
  hooks.hook = hv;
  out.push(h.auditExpandoHookKept(hooks));
  const bv = { tag: 10 };
  try { hooks.boom = bv; } catch (e) { out.push(e.message); }
  h.auditKeep(bv);
  out.push(h.auditExpandoHookKept(hooks));
  return out.join(" ");
}
