// @options: {"hostHandles": true}
// @native-any-only: JSON.stringify of any-typed values meets the dyn serializer only in the native any model
// JSON.stringify of a circular structure throws V8's TypeError text: where the cycle starts, each hop (property or array index) and the closing property.
// circular structures: V8's message
const a: any = { name: "a" }; a.self = a;
try { JSON.stringify(a); } catch (e: any) { console.log(e.name + ": " + e.message); }
const y: any = { z: 1 }; const x: any = { y }; const b: any = { x }; y.back = b;
try { JSON.stringify(b); } catch (e: any) { console.log(e.message); }
const inner: any = { w: 1 }; const arrCycle: any = [1, inner]; inner.list = arrCycle;
try { JSON.stringify(arrCycle); } catch (e: any) { console.log(e.message); }
class Node2 { next: any = null; }
const n1: any = new Node2(), n2: any = new Node2(); n1.next = n2; n2.next = n1;
try { JSON.stringify(n1); } catch (e: any) { console.log(e.message); }
