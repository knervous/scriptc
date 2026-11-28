/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Fiber } from './ReactInternalTypes';
export function runWithFiberInDEV<Args extends Array<unknown>, T>(fiber: null | Fiber, callback: (...args: Args) => T, ...args: Args): T {
    ;
    // These errors should never make it into a build so we don't need to encode them in codes.json
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error('runWithFiberInDEV should never be called in production. This is a bug in React.');
}
