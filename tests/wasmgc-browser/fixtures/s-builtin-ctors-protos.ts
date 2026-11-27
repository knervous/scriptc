// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled values and the untyped helper's builtin reads meet only in the native any model
// The constructor of a Number/Boolean/String/function value, and the prototypes of plain objects, Map and Set, are compiled values on the native host.
import { ctors, protos } from './s-builtin-ctors-protos-helper.js';
const plain: any = { a: 1 };
const fn: any = function f() { return 1; };
console.log(ctors(5 as any, true as any, "s" as any, fn, plain, [1] as any, new Map<any, any>([[1, 2]]), new Set<any>([1])).join());
console.log(protos(plain, [1] as any, new Map<any, any>([[1, 2]]), new Set<any>([1])).join());
