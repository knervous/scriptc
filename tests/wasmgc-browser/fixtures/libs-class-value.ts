// @known-defect(engine): a JS class used as a value (class expression, construction through a binding) has no engine-dyn lowering (classval)
import { run } from "./libs-class-value-helper.js";
console.log(run());
