// An if condition's short-circuited operand in JavaScript fences at its own evaluation, not at the statement: the
// statement runs and the operand never does.
import { note, quick } from "./js-condition-skippable-operand-helper.js";
console.log(note(new Error("e"), false), note(1, false), quick(new Error("e"), false), quick("x", false));
