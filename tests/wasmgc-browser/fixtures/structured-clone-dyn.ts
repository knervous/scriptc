// structuredClone of an `any` value (the checked-dynamic tree): a deep copy that shares nothing with
// the original, keeps shared references and cycles inside the value, copies typed arrays,
// and refuses functions and symbols with the page's DataCloneError.
const page: any = globalThis;
const source: any = JSON.parse('{"name":"a","n":1,"list":[1,2,{"deep":true}],"nested":{"x":[3]},"none":null}');
const copy: any = structuredClone(source);
copy.nested.x.push(4);
copy.list[2].deep = false;
console.log(JSON.stringify(source), JSON.stringify(copy), copy !== source, copy.nested !== source.nested);
const shared = { v: 1 };
const twice: any = { a: shared, b: shared };
const twiceCopy: any = structuredClone(twice);
console.log(twiceCopy.a === twiceCopy.b, twiceCopy.a !== shared);
const cyc: any = { name: "loop" };
cyc.self = cyc;
const cycCopy: any = structuredClone(cyc);
console.log(cycCopy.self === cycCopy, cycCopy !== cyc, cycCopy.name);
const rich: any = { bytes: new Uint8Array([1, 2, 3]), floats: new Float32Array([0.5]), flag: true, text: "t" };
const richCopy: any = structuredClone(rich);
console.log(richCopy.bytes[2], richCopy.bytes !== rich.bytes, richCopy.floats[0], richCopy.flag, richCopy.text);
try {
  structuredClone({ f: () => 1 } as any);
  console.log("no throw");
} catch (e) {
  console.log("function refused", e instanceof DOMException);
}
try {
  structuredClone(page.auditSymbol());
  console.log("no throw");
} catch (e) {
  console.log("symbol refused", e instanceof DOMException);
}
console.log(structuredClone(page.auditIdentity(5)), structuredClone(page.auditIdentity("s")), structuredClone(page.auditIdentity(undefined)), structuredClone(page.auditIdentity(null)));
export {};
