/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Transition } from 'react/src/ReactStartTransition';
import noop from 'shared/noop';
import type { FulfilledThenable,RejectedThenable,Thenable } from 'shared/ReactTypes';
import reportGlobalError from 'shared/reportGlobalError';
import type { Lane } from './ReactFiberLane';
import { NoLane } from './ReactFiberLane';
import { requestTransitionLane } from './ReactFiberRootScheduler';
import { clearEntangledAsyncTransitionTypes } from './ReactFiberTransitionTypes';
// If there are multiple, concurrent async actions, they are entangled. All
// transition updates that occur while the async action is still in progress
// are treated as part of the action.
// The ideal behavior would be to treat each async function as an independent
// action. However, without a mechanism like AsyncContext, we can't tell which
// action an update corresponds to. So instead, we entangle them all into one.
// The listeners to notify once the entangled scope completes.
// Listeners are thenable resolve callbacks; React calls each with no arguments.
let currentEntangledListeners: Array<(value?: unknown) => unknown> | null = null;
// The number of pending async actions in the entangled scope.
let currentEntangledPendingCount: number = 0;
// The transition lane shared by all updates in the entangled scope.
let currentEntangledLane: Lane = NoLane;
// A thenable that resolves when the entangled scope completes. It does not
// resolve to a particular value because it's only used for suspending the UI
// until the async action scope has completed.
let currentEntangledActionThenable: Thenable<undefined> | null = null;
// The clean up function for the currently running indicator.
let pendingIsomorphicIndicator: null | (() => void) = null;
// The number of roots that have pending Transitions that depend on the
// started isomorphic indicator.
let pendingEntangledRoots: number = 0;
let needsIsomorphicIndicator: boolean = false;
export function entangleAsyncAction<S>(transition: Transition, thenable: Thenable<S>): Thenable<S> {
    // `thenable` is the return value of the async action scope function. Create
    // a combined thenable that resolves once every entangled scope function
    // has finished.
    if (currentEntangledListeners === null) {
        // There's no outer async action scope. Create a new one.
        const entangledListeners: Array<(value?: unknown) => unknown> = (currentEntangledListeners = []);
        currentEntangledPendingCount = 0;
        currentEntangledLane = requestTransitionLane(transition);
        const entangledThenable: Thenable<undefined> = {
            status: 'pending',
            value: undefined,
            then(resolve: (value?: unknown) => unknown) {
                entangledListeners.push(resolve);
            },
        };
        currentEntangledActionThenable = entangledThenable;
        ;
    }
    currentEntangledPendingCount++;
    thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
    return thenable;
}
function pingEngtangledActionScope() {
    if (--currentEntangledPendingCount === 0) {
        ;
        clearEntangledAsyncTransitionTypes();
        if (pendingEntangledRoots === 0) {
            stopIsomorphicDefaultIndicator();
        }
        if (currentEntangledListeners !== null) {
            // All the actions have finished. Close the entangled async action scope
            // and notify all the listeners.
            if (currentEntangledActionThenable !== null) {
                const fulfilledThenable: FulfilledThenable<undefined> = (currentEntangledActionThenable as FulfilledThenable<undefined>);
                fulfilledThenable.status = 'fulfilled';
            }
            const listeners = currentEntangledListeners;
            currentEntangledListeners = null;
            currentEntangledLane = NoLane;
            currentEntangledActionThenable = null;
            needsIsomorphicIndicator = false;
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                listener();
            }
        }
    }
}
// Resolves to `result` once `thenable` settles (the thenable's own value is not used).
export function chainThenableValue<T>(thenable: Thenable<unknown>, result: T): Thenable<T> {
    // Equivalent to: Promise.resolve(thenable).then(() => result), except we can
    // cheat a bit since we know that that this thenable is only ever consumed
    // by React.
    //
    // We don't technically require promise support on the client yet, hence this
    // extra code.
    const listeners: Array<(arg1: T) => unknown> = [];
    const thenableWithOverride: Thenable<T> = {
        status: 'pending',
        value: null,
        reason: null,
        then(resolve: (arg1: T) => unknown) {
            listeners.push(resolve);
        },
    };
    thenable.then((value: unknown) => {
        const fulfilledThenable: FulfilledThenable<T> = thenableWithOverride;
        fulfilledThenable.status = 'fulfilled';
        fulfilledThenable.value = result;
        for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i];
            listener(result);
        }
    }, (error) => {
        const rejectedThenable: RejectedThenable<T> = thenableWithOverride;
        rejectedThenable.status = 'rejected';
        rejectedThenable.reason = error;
        for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i];
            // This is a perf hack where we call the `onFulfill` ping function
            // instead of `onReject`, because we know that React is the only
            // consumer of these promises, and it passes the same listener to both.
            // We also know that it will read the error directly off the
            // `.reason` field.
            listener((undefined as T));
        }
    });
    return thenableWithOverride;
}
export function peekEntangledActionLane(): Lane {
    return currentEntangledLane;
}
export function peekEntangledActionThenable(): Thenable<undefined> | null {
    return currentEntangledActionThenable;
}
export function registerDefaultIndicator(onDefaultTransitionIndicator: () => undefined | (() => void)): void {
    {
        return;
    }
}
export function startIsomorphicDefaultIndicatorIfNeeded() {
    {
        return;
    }
}
function stopIsomorphicDefaultIndicator() {
    {
        return;
    }
}
function releaseIsomorphicIndicator() {
    if (--pendingEntangledRoots === 0) {
        stopIsomorphicDefaultIndicator();
    }
}
export function hasOngoingIsomorphicIndicator(): boolean {
    return pendingIsomorphicIndicator !== null;
}
export function retainIsomorphicIndicator(): () => void {
    pendingEntangledRoots++;
    return releaseIsomorphicIndicator;
}
