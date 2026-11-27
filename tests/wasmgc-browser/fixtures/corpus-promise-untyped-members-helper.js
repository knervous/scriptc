function id(value) { return value; }
async function success() { return 7; }
export function promiseMembers() {
  const p = id(success());
  /** @type {any[]} */
  const out = [typeof p.then, typeof p.catch, typeof p.finally, Object.prototype.toString.call(p), id(p) === p];
  return p.then((v) => { out.push(v); return id(success()).finally(() => out.push("finally")); })
    .then((v) => { out.push(v); return id(success()).then((x) => x * 2); })
    .then((v) => { out.push(v); return out.join(" "); });
}
