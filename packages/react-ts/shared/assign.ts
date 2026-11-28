/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty, writeProperty } from './dynamicProperty';
// Object.assign: for each source that is not null or undefined, its own enumerable keys (strings in key order, then
// symbols) are read and set on the target (symbols: see below), which is returned. React's `const assign = Object.assign` is an alias of
// an overloaded generic, which the compiled build has no single signature for.
// One source per call (two sources: assign(assign(target, a), b), the same sequence of copies).
function assign<T extends object>(target: T, source: unknown): T {
    {
        if (source === null || source === undefined) {
            return target;
        }
        const from = Object(source) as object;
        const keys = Object.keys(from);
        for (let k = 0; k < keys.length; k++) {
            writeProperty(target, keys[k], readProperty(from, keys[k]));
        }
        // Symbol-keyed properties are not copied by this build: a source carrying an enumerable one is refused loudly
        // (React's own objects and props never have them).
        const symbols = Object.getOwnPropertySymbols(from);
        for (let s = 0; s < symbols.length; s++) {
            if (Object.prototype.propertyIsEnumerable.call(from, symbols[s])) {
                throw new TypeError('assign: symbol-keyed properties are not supported in this build');
            }
        }
    }
    return target;
}
export default assign;
