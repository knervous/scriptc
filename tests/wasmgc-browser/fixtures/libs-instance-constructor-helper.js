// `value.constructor` through untyped values: a library class instance
// answers its class (not the bag's inherited Object), a thrown Error
// subclass instance its class, and a runtime error the page's constructor.
class A { constructor() { this.v = 1; } m() { return 2; } }
class B extends A { toString() { return "B!"; } }
class MyErr extends Error { constructor(m) { super(m); this.name = "MyErr"; } }
function info(e) { return e.name + " " + (e instanceof TypeError) + " " + e.constructor.name + " " + (e.constructor === TypeError); }
export function run() {
  var out = [];
  var d = JSON.parse("[0, 0]");
  d[0] = new A(); d[1] = new B();
  out.push((d[0].constructor === A) + " " + d[0].constructor.name + " " + (d[1].constructor === B) + " " + d[1].constructor.name + " " + d[1].toString());
  var k = "constructor";
  out.push((d[0][k] === A) + " " + (d[1][k] === B));
  try { throw new MyErr("x"); } catch (e) { out.push(e.name + " " + (e instanceof MyErr) + " " + (e instanceof Error) + " " + e.constructor.name + " " + (e.constructor === MyErr)); }
  var u = JSON.parse("null");
  try { u.x; } catch (e) { out.push("get " + info(e)); }
  try { u(); } catch (e) { out.push("call " + info(e)); }
  try { [...u]; } catch (e) { out.push("spread " + info(e)); }
  try { throw new TypeError("m"); } catch (e) { out.push("new " + info(e)); }
  try { new Array(-1); } catch (e) { out.push("range " + e.constructor.name + " " + (e.constructor === RangeError)); }
  try { JSON.parse("{"); } catch (e) { out.push("syntax " + e[k].name + " " + (e[k] === SyntaxError)); }
  // An expando joins the instance's own keys after its created fields
  // (engine dyn refuses expandos on fixed-shape class facades).
  d[0].extra = 9;
  out.push(Object.keys(d[0]).join(",") + " " + JSON.stringify(Object.values(d[0])) + " " + ("extra" in d[0]));
  return out.join("\n");
}
