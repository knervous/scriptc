import type { Vec } from "./vec.ts";
export interface Node { name: string; position: Vec; children: Node[] }
