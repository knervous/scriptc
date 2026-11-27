function make(key, value) { return { [key]: value }; }
function at(object, key) { return object[key]; }
export function report() {
  let calls = 0;
  const key = { toString() { calls++; return 'value'; } };
  const object = make(key, 7);
  return [at(object, 'value'), at(make(null, 8), 'null'), at(make(undefined, 9), 'undefined'), at(make(3, 11), 3), at(make(true, 12), 'true'), at(make('__proto__', 13), '__proto__'), calls].join('|');
}
