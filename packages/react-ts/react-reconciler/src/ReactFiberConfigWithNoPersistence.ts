/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Instance, TextInstance } from 'react-dom-bindings/src/client/ReactFiberConfigDOM';
// Renderers that don't support persistence
// can re-export everything from this module.
function shim(...args: Array<unknown>): never {
    throw new Error('The current renderer does not support persistence. ' +
        'This error is likely caused by a bug in React. ' +
        'Please file an issue.');
}
// Persistence (when unsupported)
export const supportsPersistence = false;
// The shims a caller reads an instance from are typed as returning one (a call typed `never` lowers as a number in compiled code).
export function cloneInstance(...args: Array<unknown>): Instance {
    return shim(...args);
}
export const createContainerChildSet = shim;
export const appendChildToContainerChildSet = shim;
export const finalizeContainerChildren = shim;
export const replaceContainerChildren = shim;
export function cloneHiddenInstance(...args: Array<unknown>): Instance {
    return shim(...args);
}
export function cloneHiddenTextInstance(...args: Array<unknown>): TextInstance {
    return shim(...args);
}
