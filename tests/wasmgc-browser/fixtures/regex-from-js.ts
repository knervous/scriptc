// A RegExp coming back from untyped JavaScript into a typed RegExp binding: it is the same host regex
// (test/exec/source/flags/lastIndex).
import { makePattern } from "./regex-from-js-helper.js";
const re: RegExp = makePattern("cat");
console.log(re.source, re.flags, re.test("a Cat sat"), re.lastIndex, "cat dog CAT".replace(re, "x"));
