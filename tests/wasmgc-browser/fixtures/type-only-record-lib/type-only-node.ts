import type { Vec } from "./type-only-vec.ts";
export interface Node { name: string; position: Vec; children: Node[] }
