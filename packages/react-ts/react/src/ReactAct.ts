/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Thenable } from 'shared/ReactTypes';
export function act<T>(callback: () => T | Thenable<T>): Thenable<T> {
    {
        throw new Error('act(...) is not supported in production builds of React.');
    }
}
