// Generates vertex.gen.ts, the particle vertex layout of the GPU-buffer benchmark (the layout intrinsic library's
// layoutSource), and prints the same layout as WGSL. Run: node benchmarks/intrinsics/particles/gen.mjs
import fs from "node:fs";
import { layout, layoutSource, wgslStruct } from "../../../packages/intrinsics/layout.ts";

export const VERTEX = layout("Vertex", [
  { name: "x", type: "f32" }, { name: "y", type: "f32" }, { name: "vx", type: "f32" }, { name: "vy", type: "f32" },
  { name: "rgba", type: "u32" }, { name: "size", type: "f32" }, { name: "life", type: "f32" },
], { align: 16 });
fs.writeFileSync(new URL("./vertex.gen.ts", import.meta.url), layoutSource(VERTEX));
console.log(wgslStruct(VERTEX));
