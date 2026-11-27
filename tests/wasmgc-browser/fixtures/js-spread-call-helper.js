function collect(...values) { return values.join(':'); }
function invoke(f, first, rest, last) { return f(first, ...rest, last); }
function copy(source) { return { ...source, before: 1, after: 2 }; }
export function report(page) {
  const order = [];
  const args = page.auditSpreadIterable(order);
  page.auditCollect = collect;
  const out = [page.auditCollect(0, ...[1, 2, 3, 4, 5], 6), page.auditCollect(7, ...args, 9), order.join(',')];
  const a = copy({value: 8}); out.push(a.before, a.value, a.after);
  const b = copy(null); out.push(b.before, b.after);
  const original = {value: 4}; const c = copy(original); original.value = 5; out.push(c.value);
  const sparse = []; sparse.length = 2; out.push(page.auditCollect('x', ...sparse, 'y'));
  return out.join('|');
}
