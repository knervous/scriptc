// @options: {"hostHandles": true}
// @native-any-only: the untyped helper's any-typed constructors meet the page host only in the native any model
// `new f()` where f is an untyped value that is a COMPILED function constructs compiled-side (f.prototype, object results,
// instanceof); only genuine page constructors reach js.construct.
import { cache, viaPage, viaArgs, replaced, klass, pageCtor, notCtor, Plain } from './host-handles-construct-compiled-helper.js';
const g = globalThis as any;
console.log(cache().join());
console.log(viaPage(new g.Object()).join());
const p = viaArgs(Plain, 4, 5);
console.log(p.sum, p.twice(), p instanceof Plain);
console.log(replaced().join(), klass().join(), pageCtor().join(), notCtor());
const d = viaArgs(g.Date, 0, 0);
console.log(d instanceof g.Date, typeof d.getTime());
