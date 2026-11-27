export class Base {
  constructor(v) { this.v = v; }
  clone() { return new this.constructor(this.v); }
  copyFrom(source) { this.v = source.v; return this; }
}
export class Derived extends Base {
  constructor(v) { super(v); this.tag = "d"; }
}
export function cloneAll(list) { return list.map((b) => b.clone()); }
