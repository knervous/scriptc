// Captures read before initialization still throw (temporal dead zone) after ir/capture-values.ts.
function early(): string {
  const read = () => value;
  let out = "";
  try { out += read(); } catch (e) { out += (e as Error).name + ":" + (e as Error).message; }
  const value = 42;
  out += " " + read();
  return out;
}
console.log("early", early());

function ordered(): string {
  function get(): number { return limit * 2; }
  const limit = 21;
  return `${get()}`;
}
console.log("ordered", ordered());

function forward(): string {
  const fns: (() => number)[] = [];
  const f = () => g();
  let out = "";
  try { f(); } catch (e) { out += (e as Error).name; }
  const g = () => k;
  const k = 5;
  out += " " + f();
  fns.push(f);
  return out;
}
console.log("forward", forward());
