import { Vec } from "./vec.ts";
import type { Node } from "./node.ts";
export function makeNode(name: string, x: number): Node {
  return { name, position: new Vec(x), children: [] };
}
