import type { Node } from "./type-only-record-lib/type-only-node.ts";
function nameLength(node: Node | null): number { return node === null ? -1 : node.name.length; }
console.log(nameLength(null));
