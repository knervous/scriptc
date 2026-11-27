// @hits(native,native-any): ^\$dyncoll\.new\.map$
// @hits(native,native-any): ^\$dyncoll\.new\.set$
// @hits(native,native-any): ^\$dyncoll\.get\.1$
// @hits(native,native-any): ^\$dyncoll\.set\.2$
// @hits(native,native-any): ^\$dyncoll\.has\.1$
// @hits(native,native-any): ^\$dyncoll\.delete\.1$
// @hits(native,native-any): ^\$dyncoll\.add\.1$
// @hits(native,native-any): ^\$dyncoll\.clear\.0$
// @hits(native,native-any): ^\$dyncoll\.forEach\.
// @hits(native,native-any): ^\$dyncoll\.member$
// @hits(native,native-any): ^\$dyncoll\.toJs\.map$
// @hits(native,native-any): ^\$hash\.dyn\.native$
// @hits(native,native-any): ^\$dyncoll\.has$
// Map and Set constructed in untyped code run as compiled collections:
// keys, order, forEach under mutation, construction sources, member reads,
// conversions, and crossing to the page as one live collection
// (js-collections-native-helper.js).
import { basics, keys, forEachRules, construction, members, crossing, ownProperties } from "./js-collections-native-helper.js";
const page: any = globalThis;
const run = (label: string, f: () => string) => { try { console.log(label, f()); } catch (e) { console.log(label, "threw", (e as Error).name + ": " + (e as Error).message); } };
run("basics", () => basics());
run("keys", () => keys(page.auditMake()));
run("forEach", () => forEachRules());
run("construction", () => construction(page));
run("members", () => members());
run("crossing", () => crossing(page));
run("ownProperties", () => ownProperties(page));
