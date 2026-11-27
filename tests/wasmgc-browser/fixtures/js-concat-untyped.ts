// A typed array's concat with untyped arguments decides spread-or-append at
// run time (IsArray), as JS does.
import { run } from "./js-concat-untyped-helper.js";
console.log(run(JSON.parse("[1,2]"), JSON.parse("7")));
const nums = [1, 2];
const d: any = JSON.parse("[3,4]"), one: any = JSON.parse("5");
console.log(nums.concat(d).join(","), nums.concat(one).join(","), nums.concat(d, one).length);
