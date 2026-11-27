// Spreading a record whose optional field is unset copies nothing for it
// (no own property), so the earlier contributor stays: `{ visible: true,
// ...opts }` keeps true unless opts set visible. A field set to a value,
// including false or 0, overrides; a later property still wins over both.
interface Opts { name: string; visible?: boolean; scale?: number }
function merge(o: Opts): Opts { return { visible: true, scale: 1, ...o }; }
function pinned(o: Opts): Opts { return { visible: true, ...o, scale: 2 }; }
const unset = merge({ name: "a" });
const set = merge({ name: "b", visible: false, scale: 0 });
const half = merge({ name: "c", scale: 3 });
console.log(unset.visible, unset.scale, set.visible, set.scale, half.visible, half.scale);
const pin = pinned({ name: "d" });
console.log(pin.name, pin.visible, pin.scale, "visible" in unset);
