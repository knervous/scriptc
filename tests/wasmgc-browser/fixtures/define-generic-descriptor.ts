// `Object.defineProperty(o, k, { enumerable: false })` on an existing property (Babylon Lite marks a mesh's
// `worldMatrix` getter non-enumerable this way): a generic descriptor keeps the getter or the value and changes only the
// attributes it names.
// @ts-ignore: an untyped helper
import { run } from "./define-generic-descriptor-helper.js";
run();
