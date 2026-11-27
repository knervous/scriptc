// @options: {"hostHandles": true}
// @native-any-only: the any-typed values and page-typed receivers meet only in the native any model
// `recv.push(...x)` where the receiver is an island (page-typed) value: the spread drains through the compiled iteration protocol.
import { pushAll, pushPre, sink, bad } from './s-method-spread-island-helper.js';
console.log(pushAll(new Set([1, 2])), pushAll(new Set([3, 4]).values()), pushAll([7, 8]), pushPre(new Map([[1, 2]]).keys()), sink(), bad());
