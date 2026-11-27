// @native-any-only: delete on any-typed receivers is an explicit refusal in the other lanes (SC1090)
// delete on a class instance held as a dyn value removes the property from its property bag,
// where the class-aware writes put it (the delete used to miss the bag: the old value answered).
import { run } from "./js-class-instance-delete-helper.js";
console.log(run());
