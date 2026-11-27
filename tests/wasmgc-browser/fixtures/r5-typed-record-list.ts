// Typed arrays of records and nested arrays shared with untyped code (alias-preserving).
import { editList } from './r5-helper.js';
type Item = { n: number; label: string };
const list: Item[] = [{ n: 1, label: "a" }, { n: 2, label: "b" }];
const grid: number[][] = [[1], [2, 3]];
const first = list[0]!;
const h: any = globalThis;
const result: string = editList(list, grid, h.auditKeys);
console.log(result);
console.log(first.n, list.length, list[2]!.label, grid[0]!.length, grid[0]![1]);
