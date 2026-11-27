var E = Error, TE = TypeError, ctors = [Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError];
export function run() {
  var out = [typeof Error, typeof TypeError, TE === TypeError, E === Error, TE !== E];
  var e = new TE("bad");
  out.push(e instanceof TE, e instanceof E, e instanceof TypeError, e instanceof RangeError, e.name, e.message, String(e), e.constructor === TE);
  var r = new ctors[2]("range");
  out.push(r.name, r instanceof Error, r instanceof ctors[2], r instanceof TE);
  var plain = TE("called"); out.push(plain.message, plain instanceof TE);
  var nomsg = new E(); out.push(nomsg.message === "", nomsg.name);
  try { throw new ctors[4]("ref"); } catch (x) { out.push(x instanceof ReferenceError, x.name, x.message); }
  out.push(Object.prototype.toString.call(e), e instanceof Object);
  return out.join("|");
}
