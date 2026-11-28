/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { LazyComponent as LazyComponentType } from 'react/src/ReactLazy';
import noop from 'shared/noop';
import type { FulfilledThenable,PendingThenable,RejectedThenable,Thenable } from 'shared/ReactTypes';
import { getWorkInProgressRoot } from './ReactFiberWorkLoop';
type ThenableStateDev = {
    didWarnAboutUncachedPromise: boolean;
    thenables: Array<Thenable<any>>;
};
type ThenableStateProd = Array<Thenable<unknown>>;
export type ThenableState = ThenableStateDev | ThenableStateProd;
function getThenablesFromState(state: ThenableState): Array<Thenable<any>> {
    {
        const prodState = (state as ThenableStateProd);
        return prodState;
    }
}
// An error that is thrown (e.g. by `use`) to trigger Suspense. If we
// detect this is caught by userspace, we'll log a warning in development.
export const SuspenseException: unknown = new Error("Suspense Exception: This is not a real error! It's an implementation " +
    'detail of `use` to interrupt the current render. You must either ' +
    'rethrow it immediately, or move the `use` call outside of the ' +
    '`try/catch` block. Capturing without rethrowing will lead to ' +
    'unexpected behavior.\n\n' +
    'To handle async errors, wrap your component in an error boundary, or ' +
    "call the promise's `.catch` method and pass the result to `use`.");
export const SuspenseyCommitException: unknown = new Error('Suspense Exception: This is not a real error, and should not leak into ' +
    "userspace. If you're seeing this, it's likely a bug in React.");
export const SuspenseActionException: unknown = new Error("Suspense Exception: This is not a real error! It's an implementation " +
    'detail of `useActionState` to interrupt the current render. You must either ' +
    'rethrow it immediately, or move the `useActionState` call outside of the ' +
    '`try/catch` block. Capturing without rethrowing will lead to ' +
    'unexpected behavior.\n\n' +
    'To handle async errors, wrap your component in an error boundary.');
// This is a noop thenable that we use to trigger a fallback in throwException.
// TODO: It would be better to refactor throwException into multiple functions
// so we can trigger a fallback directly without having to check the type. But
// for now this will do.
export const noopSuspenseyCommitThenable = {
    then() {
        ;
    },
} as const;
export function createThenableState(): ThenableState {
    {
        return [];
    }
}
export function isThenableResolved(thenable: Thenable<unknown>): boolean {
    const status = thenable.status;
    return status === 'fulfilled' || status === 'rejected';
}
export function trackUsedThenable<T>(thenableState: ThenableState, thenable: Thenable<T>, index: number): T {
    ;
    const trackedThenables = getThenablesFromState(thenableState);
    const previous = trackedThenables[index];
    if (previous === undefined) {
        trackedThenables.push(thenable as Thenable<unknown>);
    }
    else {
        if (previous !== thenable) {
            ;
            // Avoid an unhandled rejection errors for the Promises that we'll
            // intentionally ignore.
            thenable.then(noop, noop);
            thenable = previous as Thenable<T>;
        }
    }
    ;
    // We use an expando to track the status and result of a thenable so that we
    // can synchronously unwrap the value. Think of this as an extension of the
    // Promise API, or a custom interface that is a superset of Thenable.
    //
    // If the thenable doesn't have a status, set it to "pending" and attach
    // a listener that will update its status and result when it resolves.
    switch (thenable.status) {
        case 'fulfilled': {
            const fulfilledValue: T = thenable.value as T; // status is 'fulfilled': value holds the result
            return fulfilledValue;
        }
        case 'rejected': {
            const rejectedError = thenable.reason;
            checkIfUseWrappedInAsyncCatch(rejectedError);
            throw rejectedError;
        }
        default: {
            if (typeof thenable.status === 'string') {
                // Only instrument the thenable if the status if not defined. If
                // it's defined, but an unknown value, assume it's been instrumented by
                // some custom userspace implementation. We treat it as "pending".
                // Attach a dummy listener, to ensure that any lazy initialization can
                // happen. Flight lazily parses JSON when the value is actually awaited.
                thenable.then(noop, noop);
            }
            else {
                // This is an uncached thenable that we haven't seen before.
                // Detect infinite ping loops caused by uncached promises.
                const root = getWorkInProgressRoot();
                if (root !== null && root.shellSuspendCounter > 100) {
                    // This root has suspended repeatedly in the shell without making any
                    // progress (i.e. committing something). This is highly suggestive of
                    // an infinite ping loop, often caused by an accidental Async Client
                    // Component.
                    //
                    // During a transition, we can suspend the work loop until the promise
                    // to resolve, but this is a sync render, so that's not an option. We
                    // also can't show a fallback, because none was provided. So our last
                    // resort is to throw an error.
                    //
                    // TODO: Remove this error in a future release. Other ways of handling
                    // this case include forcing a concurrent render, or putting the whole
                    // root into offscreen mode.
                    throw new Error('An unknown Component is an async Client Component. ' +
                        'Only Server Components can be async at the moment. ' +
                        'This error is often caused by accidentally ' +
                        "adding `'use client'` to a module that was originally written " +
                        'for the server.');
                }
                const pendingThenable: PendingThenable<T> = thenable;
                pendingThenable.status = 'pending';
                pendingThenable.then((fulfilledValue) => {
                    if (thenable.status === 'pending') {
                        const fulfilledThenable: FulfilledThenable<T> = (thenable);
                        fulfilledThenable.status = 'fulfilled';
                        fulfilledThenable.value = fulfilledValue;
                    }
                }, (error: unknown) => {
                    if (thenable.status === 'pending') {
                        const rejectedThenable: RejectedThenable<T> = (thenable);
                        rejectedThenable.status = 'rejected';
                        rejectedThenable.reason = error;
                    }
                });
            }
            // Check one more time in case the thenable resolved synchronously.
            switch ((thenable as Thenable<T>).status) {
                case 'fulfilled': {
                    const fulfilledThenable: FulfilledThenable<T> = thenable;
                    return fulfilledThenable.value as T; // status is 'fulfilled'
                }
                case 'rejected': {
                    const rejectedThenable: RejectedThenable<T> = thenable;
                    const rejectedError = rejectedThenable.reason;
                    checkIfUseWrappedInAsyncCatch(rejectedError);
                    throw rejectedError;
                }
            }
            // Suspend.
            //
            // Throwing here is an implementation detail that allows us to unwind the
            // call stack. But we shouldn't allow it to leak into userspace. Throw an
            // opaque placeholder value instead of the actual thenable. If it doesn't
            // get captured by the work loop, log a warning, because that means
            // something in userspace must have caught it.
            suspendedThenable = thenable as Thenable<unknown>;
            ;
            throw SuspenseException;
        }
    }
}
export function suspendCommit(): void {
    // This extra indirection only exists so it can handle passing
    // noopSuspenseyCommitThenable through to throwException.
    // TODO: Factor the thenable check out of throwException
    suspendedThenable = noopSuspenseyCommitThenable;
    throw SuspenseyCommitException;
}
export function resolveLazy<T>(lazyType: LazyComponentType<T, any>): T {
    try {
        ;
        const payload = lazyType._payload;
        const init = lazyType._init;
        return init(payload);
    }
    catch (x: any) {
        if (x !== null && typeof x === 'object' && typeof x.then === 'function') {
            // This lazy Suspended. Treat this as if we called use() to unwrap it.
            suspendedThenable = x;
            ;
            throw SuspenseException;
        }
        throw x;
    }
}
// This is used to track the actual thenable that suspended so it can be
// passed to the rest of the Suspense implementation — which, for historical
// reasons, expects to receive a thenable.
let suspendedThenable: Thenable<unknown> | null = null;
export function getSuspendedThenable(): Thenable<unknown> {
    // This is called right after `use` suspends by throwing an exception. `use`
    // throws an opaque value instead of the thenable itself so that it can't be
    // caught in userspace. Then the work loop accesses the actual thenable using
    // this function.
    if (suspendedThenable === null) {
        throw new Error('Expected a suspended thenable. This is a bug in React. Please file ' +
            'an issue.');
    }
    const thenable = suspendedThenable;
    suspendedThenable = null;
    ;
    return thenable;
}
export function checkIfUseWrappedInAsyncCatch(rejectedReason: unknown) {
    // This check runs in prod, too, because it prevents a more confusing
    // downstream error, where SuspenseException is caught by a promise and
    // thrown asynchronously.
    // TODO: Another way to prevent SuspenseException from leaking into an async
    // execution context is to check the dispatcher every time `use` is called,
    // or some equivalent. That might be preferable for other reasons, too, since
    // it matches how we prevent similar mistakes for other hooks.
    if (rejectedReason === SuspenseException ||
        rejectedReason === SuspenseActionException) {
        throw new Error('Hooks are not supported inside an async component. This ' +
            "error is often caused by accidentally adding `'use client'` " +
            'to a module that was originally written for the server.');
    }
}
