export function outer(cb) { cb(); return this.n; }
export function inner() { return this.n; }
