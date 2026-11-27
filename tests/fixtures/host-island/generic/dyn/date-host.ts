// The browser frontend's host-backed Date members (date.hostNum / date.hostStr) over the LLVM time value.
const stamp = (date: Date): string => {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}-${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}.${date.getUTCMilliseconds()}`;
};
const fixed = new Date(Date.UTC(2026, 9, 26, 7, 5, 9, 42));
console.log(stamp(fixed), fixed.getTime(), fixed.valueOf(), fixed.getUTCDay(), fixed.toISOString(), fixed.toJSON());
console.log(Date.UTC(2020), Date.UTC(2020, 1), Date.UTC(99, 0, 1), Date.UTC(2020, 13, 40, 25));
// (new Date(y, m, ...) in local time is date.newParts, not lowered on this lane yet.)
const local = new Date(1767323045000);
console.log(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getDay(),
  typeof local.getTimezoneOffset());
const invalid = new Date(Number.NaN);
try { console.log(invalid.toISOString()); } catch (error) { console.log(error instanceof RangeError, (error as Error).message); }
console.log(Number.isNaN(invalid.getUTCFullYear()));
