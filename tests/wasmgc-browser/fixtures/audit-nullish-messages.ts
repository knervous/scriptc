// V8's exact TypeError messages for nullish receivers: constant, computed
// and symbol-keyed reads, writes ("setting 'x'"), `in`, and
// hasOwnProperty / getPrototypeOf / assign ("Cannot convert undefined or
// null to object"), in JavaScript and through TS any.
import { reads, writes } from "./audit-nullish-messages-helper.js";
const h: any = globalThis;
console.log(reads(h.auditSymbol()));
console.log(writes());
const u: any = undefined;
const k: any = "id";
try { u[k]; } catch (e) { console.log((e as Error).message); }
try { u.a.b; } catch (e) { console.log((e as Error).message); }
try { u?.a.b; console.log("short-circuit"); } catch (e) { console.log((e as Error).message); }
