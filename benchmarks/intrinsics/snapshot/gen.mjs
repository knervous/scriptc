// Generates entity.gen.ts, the view class of the snapshot benchmark's entity layout (the layout intrinsic library's
// layoutSource), and prints the same layout as a C struct. Run: node benchmarks/intrinsics/snapshot/gen.mjs
import fs from "node:fs";
import { cStruct, layout, layoutSource } from "../../../packages/intrinsics/layout.ts";

export const ENTITY = layout("Entity", [
  { name: "x", type: "f32" }, { name: "y", type: "f32" }, { name: "vx", type: "f32" }, { name: "vy", type: "f32" },
  { name: "hp", type: "u8" }, { name: "flags", type: "u8" },
]);
fs.writeFileSync(new URL("./entity.gen.ts", import.meta.url), layoutSource(ENTITY));
console.log(cStruct(ENTITY));
