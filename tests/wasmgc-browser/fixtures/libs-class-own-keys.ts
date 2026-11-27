// @known-defect(engine): an engine-dyn class facade lists every layout field as own (a conditionally assigned field not yet created reads as present, undefined)
import { run } from "./libs-class-own-keys-helper.js";
console.log(run());