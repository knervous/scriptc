/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { StackCursor } from './ReactFiberStack';
import { createCursor } from './ReactFiberStack';
import type { Fiber } from './ReactInternalTypes';
;
export const emptyContextObject: Record<any, any> = {};
;
// A cursor to the current merged context object on the stack.
const contextStackCursor: StackCursor<Record<any, any>> = createCursor<Record<any, any>>(emptyContextObject);
// A cursor to a boolean indicating whether the context has changed.
const didPerformWorkStackCursor: StackCursor<boolean> = createCursor<boolean>(false);
function getUnmaskedContext(workInProgress: Fiber, Component: Function, didPushOwnContextIfProvider: boolean): Record<any, any> {
    {
        return emptyContextObject;
    }
}
function cacheContext(workInProgress: Fiber, unmaskedContext: Record<any, any>, maskedContext: Record<any, any>): void {
    {
        return;
    }
}
function getMaskedContext(workInProgress: Fiber, unmaskedContext: Record<any, any>): Record<any, any> {
    {
        return emptyContextObject;
    }
}
function hasContextChanged(): boolean {
    {
        return false;
    }
}
function isContextProvider(type: Function): boolean {
    {
        return false;
    }
}
function popContext(fiber: Fiber): void {
    {
        return;
    }
}
function popTopLevelContextObject(fiber: Fiber): void {
    {
        return;
    }
}
function pushTopLevelContextObject(fiber: Fiber, context: Record<any, any>, didChange: boolean): void {
    {
        return;
    }
}
function processChildContext(fiber: Fiber, type: unknown, parentContext: Record<any, any>): Record<any, any> {
    {
        return parentContext;
    }
}
function pushContextProvider(workInProgress: Fiber): boolean {
    {
        return false;
    }
}
function invalidateContextProvider(workInProgress: Fiber, type: unknown, didChange: boolean): void {
    {
        return;
    }
}
function findCurrentUnmaskedContext(fiber: Fiber): Record<any, any> {
    {
        return emptyContextObject;
    }
}
export { getUnmaskedContext,cacheContext,getMaskedContext,hasContextChanged,popContext,popTopLevelContextObject,pushTopLevelContextObject,processChildContext,isContextProvider,pushContextProvider,invalidateContextProvider,findCurrentUnmaskedContext,};
