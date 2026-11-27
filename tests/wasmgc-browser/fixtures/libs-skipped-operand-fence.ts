// @release-refuses: SC2001
// @profile: eval has no static lowering; a taken operand throws its fence where Node evaluates it
// @expect: object,,5,page
// @expect: threw true
// @expect: 2 threw true
// A short-circuit operand with no static lowering fences at its own evaluation, not the whole statement:
// the never-taken fallback leaves the statement working; a taken one throws the operand's own fence.
import { probe, taken, takenArm } from "./libs-skipped-operand-fence-helper.js";
console.log(probe());
try { taken(); console.log("no throw"); } catch (e) { console.log("threw", e instanceof Error); }
let arm = String(takenArm(false));
try { takenArm(true); } catch (e) { arm += " threw " + (e instanceof Error); }
console.log(arm);
