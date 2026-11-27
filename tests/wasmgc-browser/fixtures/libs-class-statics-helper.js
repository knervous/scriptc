// Bundler-shaped classes (esbuild output): var-bound class expressions,
// static expandos, subclasses of a var binding, new.target, super() merged
// into a comma statement, and an Error subclass overriding toString.
var Base = class {
  constructor(n) { this.n = n; this.kind = new.target.name; }
  describe() { return this.kind + ":" + this.n; }
};
Base.create = (n) => new Base(n);
Base.version = 3;
var Sub = class _Sub extends Base {
  constructor(n) { super(n * 2), this.extra = "x"; }
  describe() { return "sub(" + super.describe() + ")"; }
};
var Issue = class _Issue extends Error {
  constructor(issues) {
    super(), this.issues = [];
    let proto = new.target.prototype;
    Object.setPrototypeOf(this, proto), this.name = "Issue", this.issues = issues;
  }
  toString() { return this.message; }
  get message() { return JSON.stringify(this.issues); }
};
Issue.create = (issues) => new Issue(issues);
function callIt(f) { return f(1); }
export function run() {
  var out = [];
  var b = Base.create(1), s = new Sub(2), k = Sub;
  out.push(b.describe(), s.describe(), s.extra, Base.version, Sub.version, typeof Sub.create, s instanceof Base, b instanceof Sub);
  var t = new k(5);
  out.push(t.describe(), t instanceof k, k.name, Base.name, Base.length);
  var e = Issue.create([1, 2]);
  out.push(String(e), e.message, e.name, e instanceof Error, e instanceof Issue, Object.getPrototypeOf(e) === Issue.prototype);
  try { callIt(Base); } catch (err) { out.push(err instanceof TypeError); }
  return out.join("|");
}
