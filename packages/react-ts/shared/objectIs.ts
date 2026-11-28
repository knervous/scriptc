/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
/**
 * inlined Object.is polyfill to avoid requiring consumers ship their own
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
 */
function is(x: unknown, y: any) {
    return (
    // eslint-disable-line no-self-compare
    ((x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y)));
}
// Both arms are closures of the declared type (the platform's Object.is is not adapted across function types).
const objectIs: (x?: unknown, y?: unknown) => boolean = typeof Object.is === 'function' ? (x?: unknown, y?: unknown) => Object.is(x, y) : is;
export default objectIs;
