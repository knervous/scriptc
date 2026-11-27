// char-create's name field: an untyped change event's value, filtered, then capitalised by index.
export function normalize(event) {
  const value = event.target.value.replace(/[^A-Za-z]/g, "");
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";
}
export function at(event, i) { const v = event.target.value.replace(/-/g, ""); return v[i]; }
