class Box { constructor(x) { this.x = x; } }
function read(v) { return v.x; }
export function observations(page) {
  const out = []; let calls = 0;
  const a = {x: 1}; out.push(read(a)); a.x = 2; out.push(read(a));
  a.y = 9; out.push(read(a)); page.auditDeleteKey(a, 'x'); out.push(String(read(a)));
  const inherited = {}; Object.setPrototypeOf(inherited, {x: 3}); out.push(read(inherited));
  Object.defineProperty(a, 'x', {get() {calls++; return 4;}, configurable:true});
  out.push(read(a), read(a), calls);
  const box = new Box(5); out.push(read(box)); box.x = 6; out.push(read(box));
  out.push(String(read([])), String(read('abc')), String(read(7)));
  try { read(null); } catch(e) { out.push(e.name); }
  let evaluated = 0; function next() { evaluated++; return {x: 8}; }
  out.push(read(next()), evaluated);
  return out.join('|');
}
export function sum(n) { const a = {x: 3}; let result = read(new Box(4)) - 4; for(let i=0;i<n;i++) result += read(a); return result; }
