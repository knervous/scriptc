// @plain-native-only: TS `any` is a page value in the plain native lane; an Error subclass with its own members crosses as a class facade over Error.prototype
// A user Error subclass with its own fields and methods, held as `any` or caught as `any`: the members are exact (they used to read undefined, or
// throw "is not a function"), writes reach the compiled instance, and name/message/stack/instanceof Error behave.
class HttpError extends Error {
  status = 404;
  constructor(message: string) { super(message); this.name = "HttpError"; }
  describe(): string { return `${this.name}:${this.status}`; }
}
class NotFound extends HttpError { path = "/x"; where(): string { return this.path + "@" + this.status; } }
const e = new NotFound("gone");
const x: any = e;
console.log(x.message, x.name, x.status, x.path, x.describe(), x.where(), x instanceof Error, typeof x.stack);
x.status = 410;
console.log(e.status, x.describe(), String(x));
const y: any = e;
console.log(x === y, (x as NotFound) === e);
function caught(): string {
  try { throw new HttpError("boom"); } catch (err: any) { return [err.name, err.message, err.status, err.describe(), err instanceof Error].join("|"); }
}
console.log(caught());
class Plain extends Error {}
const p: any = new Plain("q");
console.log(p.message, p.name, p instanceof Error);
