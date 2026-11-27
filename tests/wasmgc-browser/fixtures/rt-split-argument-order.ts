// `s.split(separator, limit)` runs its argument expressions in source order: the separator, then the limit (10-30: the
// limit ran first).
let receiver = "first,second";
let effects = "";
function source(): string { effects += "s"; return receiver; }
function separator(): string { effects += "p"; receiver += ",late"; return ","; }
function limit(): number { effects += "l"; return 2; }
const parts = source().split(separator(), limit());
console.log(effects, parts.join("|"), receiver);
