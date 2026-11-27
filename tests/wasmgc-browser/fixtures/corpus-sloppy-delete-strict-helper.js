export function strictDelete() {
  const out = [];
  const object = JSON.parse("{}");
  Object.defineProperty(object, "fixed", { value: 1 });
  try { delete object.fixed; out.push("deleted"); } catch (e) { out.push(e.name + ": " + e.message); }
  const arr = JSON.parse("[1,2]");
  try { delete arr.length; out.push("deleted"); } catch (e) { out.push(e.name + ": " + e.message); }
  return out.join(" | ");
}
