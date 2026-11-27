// @refuse: record shapes must match exactly or width-coerce
// A namespace member is a live binding; a record field is a snapshot. A
// namespace flowing into a record whose field is a reassigned `let` export
// has no exact lowering, so it refuses.
import * as live from "./dynamic-import-record-lib/live.ts";
const snapshot: { counter: number } = live;
live.bump();
console.log(snapshot.counter, live.counter);
