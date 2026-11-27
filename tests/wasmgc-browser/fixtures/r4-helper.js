function list(...xs){return xs}
function setProto(o,p){return Object.setPrototypeOf(o,p)}
function writeProp(o,k,v){o[k]=v}
function deleteProp(o,k){delete o[k]}
export function descriptors() {
 const o={};Object.defineProperty(o,'x',{value:1,writable:false,enumerable:false,configurable:false});
 let write='ok';try{writeProp(o,'x',2)}catch(e){write='throw'};
 let del='ok';try{deleteProp(o,'x')}catch(e){del='throw'};
 return ''+o.x+'|'+Object.keys(o).join(',')+'|'+write+'|'+del;
}
function plus(a,b){return a+b}
function minus(a,b){return a-b}
export function coercion() { const a={valueOf(){return 7}}; const b={toString(){return 'custom'}}; return ''+minus(a,2)+'|'+plus(a,1)+'|'+String(b); }
export function holeHas() { const a=list();a.length=3;a[1]=undefined;return ''+(0 in a)+'|'+(1 in a)+'|'+(2 in a)+'|'+Object.keys(a).join(','); }
export function upperKeys() { const o={};o.z=1;o['4294967294']=2;o['2147483648']=3;o.a=4;return Object.keys(o).join(','); }
export function inheritedBuiltin() { const o={};return ''+('toString' in o)+'|'+('hasOwnProperty' in o); }
export function defaultProto() { const o={};setProto(o,null);return ''+('toString' in o)+'|'+typeof o.toString; }
export function fromPage(x){return typeof x;}
export function makeBoundary(){return {n:7,a:[1,2]};}
export function bytesAlias(a){a[0]=9;return a[0];}
export function concatSparse(){const a=list();a.length=2;const b=a.concat([3]);return ''+b.length+'|'+(0 in b)+'|'+(1 in b)+'|'+(2 in b);}
export function mapMutation(){const a=list(1,2,3);const seen=list();a.forEach(function(v,i){seen.push(v);if(i===0)a.pop()});return seen.join(',');}
export function readTypedRecord(o){return o.n;}
export function descriptors2() {
  const o = { a: 1 };
  Object.defineProperty(o, 'h', { value: 2, writable: true, enumerable: false, configurable: true });
  Object.defineProperty(o, 'a', { writable: false });
  let w = 'ok'; try { writeProp(o, 'a', 5); } catch (e) { w = 'throw'; }
  const d = Object.getOwnPropertyDescriptor(o, 'h');
  Object.defineProperty(o, 'a', { writable: true, value: 3 });
  writeProp(o, 'a', 4);
  deleteProp(o, 'h');
  const copy = Object.assign({}, { x: 1 }, o);
  return '' + o.a + '|' + Object.keys(o).join(',') + '|' + w + '|' + d.enumerable + d.writable + d.configurable + '|' + ('h' in o) + '|' + Object.keys(copy).join(',');
}
export function prototypes() {
  const base = { greet: function () { return "hi " + this.n; } };
  const o = { n: 3 };
  setProto(o, base);
  const bare = {}; setProto(bare, null);
  return "" + (Object.getPrototypeOf({}) === Object.prototype) + (Object.getPrototypeOf(list()) === Array.prototype) + "|" +
    (Object.getPrototypeOf(o) === base) + "|" + o.greet() + "|" + ("greet" in o) + "|" + (Object.getPrototypeOf(bare) === null) + "|" + Object.keys(o).join(",");
}
export function facadeMake() {
  const sparse = list(1); sparse[3] = 4;
  return { n: 7, gone: 1, inner: { a: [1, 2], b: "x" }, list: list(1, 2, 3), sparse: sparse, greet: function () { return "hi" + this.n; } };
}
export function facadeCheck(o, back) { return o.n + " " + o.added + " " + o.list.join(",") + " " + ("gone" in o) + " " + (back === o); }
export function caughtErrors() {
  var out = [];
  try { throw Error("boom"); } catch (x) { out.push(typeof x.stack, x.stack.trim().split("\n")[0], x.name, x.message); }
  try { var o = null; o.f; } catch (x) { out.push(x.name, typeof x.message, x instanceof TypeError); }
  return out.join("|");
}
export function unknownOps(a, b) { return "" + a + "-" + (a == b) + "-" + (a === "" + b); }
