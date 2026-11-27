// Object.keys/values/entries of null or undefined throw (ToObject), even when
// the result is unused; Object.assign still skips them.
export function run(maybe) {
  const out = [];
  try { Object.keys(null); out.push("no throw"); } catch (e) { out.push(e.name + ": " + e.message); }
  try { Object.entries(undefined); out.push("no throw"); } catch (e) { out.push(e.name); }
  try { Object.values(maybe); out.push("no throw"); } catch (e) { out.push(e.name); }
  out.push(JSON.stringify(Object.assign({}, null, { b: 2 })));
  return out.join(" | ");
}
