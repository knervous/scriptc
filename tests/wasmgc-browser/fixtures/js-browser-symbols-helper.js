function create(key) { return { [key]: 7 }; }
function read(object, key) { return object[key]; }
function write(object, key, value) { object[key] = value; }
function copy(object) { return { ...object, x: 1 }; }
export function report(page) {
  const key = Symbol.for('scriptc.graph.fixture'), a = create(key), b = Symbol.for('scriptc.graph.other');
  const out = [read(a, key), String(read(a, b))]; write(a, key, 9); out.push(read(a, key));
  const c = copy(a); out.push(read(c, key), page.auditOwnSymbols(c).length);
  const alias = globalThis; write(alias, key, 'shared'); out.push(read(globalThis, key), read(alias, key));
  return out.join('|');
}
