// lodash's getNative: the constructor read off the global object as an untyped value.
function getNative(object, key) { return object[key]; }
var DV = getNative(globalThis, "DataView");
export function run() {
  var b = new ArrayBuffer(8);
  var tag = Object.prototype.toString.call(b);
  return [b.byteLength, b instanceof ArrayBuffer, tag, new DV(b).byteLength, new DV(new ArrayBuffer(1)).byteLength].join(":");
}
