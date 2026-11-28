/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { DiscreteEventPriority } from 'react-reconciler/src/ReactEventPriorities';
import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';
import ReactSharedInternals from 'shared/ReactSharedInternals';
// One signature (React's Flow declaration overloads it: `(fn) => R` and `() => void`); a call without fn returns undefined.
function flushSyncImpl<R>(fn?: (() => R)): R | undefined {
    const previousTransition = ReactSharedInternals.T;
    const previousUpdatePriority = ReactDOMSharedInternals.p; /* ReactDOMCurrentUpdatePriority */
    try {
        ReactSharedInternals.T = null;
        ReactDOMSharedInternals.p /* ReactDOMCurrentUpdatePriority */ =
            DiscreteEventPriority;
        if (fn) {
            return fn();
        }
        else {
            return undefined;
        }
    }
    finally {
        ReactSharedInternals.T = previousTransition;
        ReactDOMSharedInternals.p /* ReactDOMCurrentUpdatePriority */ =
            previousUpdatePriority;
        const wasInRender = ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
            .f(); /* flushSyncWork */
        ;
    }
}
// React's `export const flushSync = flushSyncImpl`: the same function under a second name.
export { flushSyncImpl as flushSync };
