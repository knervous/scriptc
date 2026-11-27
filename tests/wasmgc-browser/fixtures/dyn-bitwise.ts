// Native dyn bitwise operators run inline on number boxes and fall back to
// ToNumber for every other kind (strings, booleans, null, undefined, objects
// with valueOf, arrays, page values); large values wrap by ToInt32.
// @hits(native,native-any): ^\$dyn\.toInt32$
// @hits(native,native-any): ^\$toInt32\.cold$
// @hits(native,native-any): ^\$box\.i32$
import { bubble, grid, order, unsigned } from "./dyn-bitwise-helper.js";
console.log(grid([0, -0, 1, -1, 5.7, -5.7, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32 + 5, 2 ** 53, 1e21, -1e21, NaN, Infinity, -Infinity]));
console.log(grid(["12", "0x10", " 7 ", "abc", "", true, false, null, undefined, [5], [], [1, 2], { valueOf: () => 9 }, { toString: () => "3" }]));
console.log(order());
const leaf = { lanes: 1, childLanes: 2, subtreeFlags: 0x7fffffff, flags: 4, sibling: null };
const root = { child: { lanes: 8, childLanes: 0, subtreeFlags: 65011712 * 2, flags: -1, sibling: leaf }, flags: -4, subtreeFlags: 1, childLanes: 0 };
console.log(bubble(root), root.subtreeFlags, root.childLanes);
console.log(unsigned([2 ** 32 - 1, 7, 2 ** 31]), unsigned([]));
const big: any = (globalThis as any).auditBigInt();
try { console.log(grid([big])); } catch (e) { console.log((e as Error).name); }
