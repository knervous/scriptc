/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Fiber } from './ReactInternalTypes';
import { getStackByFiberInDevAndProd } from './ReactFiberComponentStack';
const CapturedStacks: WeakMap<object, CapturedValue<unknown>> = new WeakMap();
export type CapturedValue<T> = {
    readonly value: unknown;
    source: Fiber | null;
    stack: string | null;
};
export function createCapturedValueAtFiber(value: unknown, source: Fiber): CapturedValue<unknown> {
    // If the value is an error, call this function immediately after it is thrown
    // so the stack is accurate.
    if (typeof value === 'object' && value !== null) {
        const existing = CapturedStacks.get(value);
        if (existing !== undefined) {
            return existing as CapturedValue<unknown>; // cached for this same value object
        }
        const captured: CapturedValue<unknown> = {
            value,
            source,
            stack: getStackByFiberInDevAndProd(source),
        };
        CapturedStacks.set(value, captured);
        return captured;
    }
    else {
        return {
            value,
            source,
            stack: getStackByFiberInDevAndProd(source),
        };
    }
}
export function createCapturedValueFromError(value: unknown, stack: null | string): CapturedValue<unknown> {
    const captured = {
        value,
        source: null,
        stack: stack,
    } as const;
    if (typeof stack === 'string' && typeof value === 'object' && value !== null) {
        CapturedStacks.set(value, captured);
    }
    return captured;
}
