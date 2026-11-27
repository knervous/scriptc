// `delete` with constant, computed and number keys on page objects and arrays
// (React's detachDeletedInstance removes its expando keys from DOM nodes), on
// compiled objects, and on a frozen page object (strict mode: TypeError).
const key = "__reactFiber$" + "x1";
export function makeOwn() { return { a: 1, b: 2, 3: 4 }; }
export function pageDelete(node, arr, frozen, own, keys) {
  node[key] = 1; node.extra = 2; node.kept = 3;
  const out = [keys(node)];
  delete node[key]; delete node.extra; delete node["missing"];
  out.push(keys(node), key in node, "extra" in node);
  delete arr[0]; const i = 1; delete arr[i];
  out.push(String(arr[0]), 0 in arr, arr.length);
  try { delete frozen.n; out.push("no throw"); } catch (e) { out.push(e instanceof TypeError ? "TypeError" : "other"); }
  try { delete frozen[key + "n"]; out.push("absent ok"); } catch (e) { out.push("threw"); }
  delete own.a; delete own[key]; delete own[3];
  out.push(Object.keys(own).join("+"));
  return out.join(" ");
}
