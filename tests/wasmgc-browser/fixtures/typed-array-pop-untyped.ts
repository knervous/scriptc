// Array.prototype.pop from untyped code on typed arrays (numbers, strings, records): the element comes back and the
// typed array itself is shorter, as the typed side then sees.
import { drain, popOne } from "./typed-array-pop-untyped-helper.js";
const nums: number[] = [1, 2.5, 3];
console.log(drain(nums), nums.length);
const words: string[] = ["a", "b"];
console.log(drain(words), words.length);
interface Point { x: number; y: number }
const points: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
const last = popOne(points) as Point;
console.log(last.x, last.y, points.length, points[0]!.x);
points.push({ x: 5, y: 6 });
console.log(points.length, points[1]!.y);
const empty: number[] = [];
console.log(String(popOne(empty)), empty.length);
