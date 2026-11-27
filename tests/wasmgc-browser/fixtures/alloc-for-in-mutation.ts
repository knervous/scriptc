// for-in over untyped objects under mutation: adds, deletes, re-adds, dictionary moves, prototype keys, key reuse.
// @hits(native,native-any): ^\$obj\.forInAtoms$
import { basics, mutation, prototypes, keyUses, accessors } from './alloc-for-in-mutation-helper.js';
console.log(basics());
console.log(mutation());
console.log(prototypes());
console.log(keyUses());
console.log(accessors());
