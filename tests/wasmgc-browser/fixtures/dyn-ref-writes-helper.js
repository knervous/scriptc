// Untyped code writing into the fields of compiled class instances.
export function selfAssign(node) { node.children = node.children; return node.children; }
export function copyMaterial(a, b) { a.material = b.material; return a.material; }
export function setField(node, name, value) { node[name] = value; return node[name]; }
export function setDevice(node, v) { node._device = v; return node._device; }
export function setChildren(node, v) { node.children = v; return node.children; }
export function setOrtho(node, v) { node.ortho = v; return node.ortho; }
export function callBack(box) { return box.make("x").label; }
export function passThrough(box, item) { return box.take(item); }
export function mkKids() { return [{ id: 7, describe() { return "kid7"; } }]; }
export function mkKid() { return { id: 8, describe() { return "kid8"; } }; }
