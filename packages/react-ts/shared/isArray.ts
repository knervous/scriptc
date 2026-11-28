/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
const isArrayImpl = Array.isArray;
// Narrows like Array.isArray (Flow declares it with %checks).
function isArray(a: unknown): a is readonly unknown[] {
    return isArrayImpl(a);
}
export default isArray;
