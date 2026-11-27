// Untyped JS code reading fields of compiled class instances (react-dom's generic `node.children`, `x.state`).
export function describe(node) {
  const m = node.material;
  return [m === null ? "none" : m.name, m === null ? 0 : m.bind(), node.children.length, node.children[0] === undefined ? "-" : typeof node.children[0], typeof node.onPick].join(" ");
}
export function sameMaterial(node, other) { return node.material === other; }
export function childAt(node, i) { return node.children[i]; }
