import { OPS as OPS_, runOp } from "./gcwork.js";
export const OPS: string[] = OPS_;
let n = 1000;
export function setup(count: number): number { n = count; return count; }
export function run(op: number, reps: number): number {
  let s = 0;
  for (let i = 0; i < reps; i++) s = (s + runOp(op, n)) | 0;
  return s;
}
