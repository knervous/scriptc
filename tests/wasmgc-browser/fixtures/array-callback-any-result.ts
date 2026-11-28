// `["[", "]"].some((b) => id.includes(b))` with `id` untyped: an array method's callback over typed elements whose
// result is an untyped value (any), tested for truthiness as JS does.
// @ts-ignore: an untyped helper
import { parameterId, picks } from "./array-callback-any-result-helper.js";
console.log(parameterId("[abc]", "[", "]"), parameterId("[a[c]", "[", "]"), parameterId("{x}", "[", "]"), parameterId("[]", "[", "]"));
console.log(JSON.stringify(picks("xccc")), JSON.stringify(picks("bb")));
