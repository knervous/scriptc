// A dynamic array stored on a page object under a computed key crosses as
// its live facade in the same call as the store (js.setFacade, kind 1).
var key = "__reactEvents$" + Math.random().toString(36).slice(2);
export function run(h) {
  const node = h.auditExpandoNode();
  const list = Array(3); list[0] = 1; list[1] = "two"; list[2] = null;
  node[key] = list;
  const out = [node[key] === list, h.auditExpandoRead(node, key)];
  h.auditKeep(list);
  out.push(h.auditExpandoKept(node, key));
  list.push(4);
  out.push(h.auditExpandoRead(node, key), node[key].length);
  return out.join(" ");
}
