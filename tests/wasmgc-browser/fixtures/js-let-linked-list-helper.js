// React-Redux's listener collection shape: captured null bindings become
// records, and traversal locals must retain the dynamic value they receive.
function collection() {
  let first = null, last = null;
  return {
    subscribe(callback) {
      let listener = { callback, next: null, prev: last };
      if (last) last.next = listener; else first = listener;
      last = listener;
      return () => {
        if (listener.next) listener.next.prev = listener.prev; else last = listener.prev;
        if (listener.prev) listener.prev.next = listener.next; else first = listener.next;
      };
    },
    notify() { let listener = first; while (listener) { listener.callback(); listener = listener.next; } },
    count() { let n = 0, listener = first; while (listener) { n++; listener = listener.next; } return n; }
  };
}
export function report() {
  const list = collection(), events = [];
  const a = list.subscribe(() => events.push('a'));
  const b = list.subscribe(() => events.push('b'));
  list.notify(); events.push(list.count()); a(); list.notify(); events.push(list.count()); b(); list.notify(); events.push(list.count());
  let mixed = null; function assign() { mixed = {value: 7}; } assign(); events.push(mixed.value); mixed = 'done'; events.push(mixed);
  return events.join('|');
}
