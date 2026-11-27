// @refuse: a DataView passed to untyped code
// A DataView is a bytes<u8> value in the IR: crossing into untyped code it
// would become a Uint8Array (other members, typeof, instanceof), so the
// crossing is refused. Corpus: js-dataview-dispatch.
import { readFirst } from "./corpus-dataview-untyped-refusal-helper.js";
const view = new DataView(new ArrayBuffer(8));
view.setUint8(0, 5);
try { console.log(readFirst(view)); } catch (e) { console.log((e as Error).message.includes("not supported") ? "refused" : (e as Error).message); }
