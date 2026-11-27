export function writes() {
  const out = [];
  for (const text of ["5", '"abc"', "true", "1.5"]) {
    const v = JSON.parse(text);
    try { v["x" + ""] = 1; out.push("ok"); } catch (e) { out.push(e.name + ": " + e.message); }
  }
  return out.join("\n");
}
