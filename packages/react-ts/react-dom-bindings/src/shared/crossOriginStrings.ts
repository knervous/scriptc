/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export type CrossOriginString = string;
export function getCrossOriginString(input?: string | null): CrossOriginString | null | undefined {
    if (typeof input === 'string') {
        return input === 'use-credentials' ? input : '';
    }
    return undefined;
}
export function getCrossOriginStringAs(as?: string | null, input?: string | null): CrossOriginString | null | undefined {
    if (as === 'font') {
        return '';
    }
    if (typeof input === 'string') {
        return input === 'use-credentials' ? input : '';
    }
    return undefined;
}
