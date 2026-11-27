export function defineOnArray() {
  const arr = JSON.parse("[1,2]");
  let outcome = "defined";
  try { Object.defineProperty(arr, "5", { value: 1 }); } catch (e) { outcome = e.message.includes("not supported") ? "refused" : e.message; }
  return [outcome, arr[5], arr.length].join(" ");
}
