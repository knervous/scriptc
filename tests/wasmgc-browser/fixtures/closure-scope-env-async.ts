// An async function capturing a variable that synchronous closures of the same scope share: the
// variable keeps its cell (an async frame holds cell references), the closures still see one binding.
// @native-only: the engine lane's async closures over page values fail independently of this layout
import { withAsync } from "./closure-scope-env-helper.js";
withAsync().then((v: string) => console.log(v));
