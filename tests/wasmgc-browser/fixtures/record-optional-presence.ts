// @known-defect(engine,native,native-any): optional record fields have no presence state: an own undefined reads absent (Object.keys omits an unset field, so an explicit undefined disappears), delete leaves the key (ledger F013/F003)
// @known-defect-expect: stdout: explicit undefined/undefined in:false/false keys: json:{}
// Presence of optional record fields (ledger F013/F003): an own property
// holding undefined is present, an omitted or deleted one is absent. Spread
// copies present properties (undefined included), `in` and Object.keys report
// presence, and JSON omits undefined values under its own rule.
interface Opts { scale?: number; visible?: boolean }
function merge(o: Opts): Opts { return { scale: 1, visible: true, ...o }; }
function show(o: Opts): string {
  return `${o.scale}/${o.visible} in:${"scale" in o}/${"visible" in o} keys:${Object.keys(o).join(",")} json:${JSON.stringify(o)}`;
}
const absent: Opts = {};
const explicit: Opts = { scale: undefined };
const zero: Opts = { scale: 0, visible: false };
const assigned: Opts = { scale: 2 };
assigned.scale = undefined;
const deleted: Opts = { scale: 3, visible: false };
delete deleted.scale;
for (const [name, o] of [["absent", absent], ["explicit", explicit], ["zero", zero], ["assigned", assigned], ["deleted", deleted]] as const) {
  console.log(name, show(o), "| merged", show(merge(o)));
}
