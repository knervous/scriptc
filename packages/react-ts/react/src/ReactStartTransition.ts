/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
import noop from 'shared/noop';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import type { GestureOptions,GestureProvider,StartTransitionOptions } from 'shared/ReactTypes';
import reportGlobalError from 'shared/reportGlobalError';
import type { TransitionTypes } from './ReactTransitionType';
// The production client's transition object: React creates it as {} (gesture, name, startTime and _updatedFibers belong
// to features and development builds this build leaves off), and reads only `types`, which stays undefined unless a
// view transition type is added.
export type Transition = {
    types: undefined | null | TransitionTypes;
};
// The scope may return a promise (an async action); React watches it for errors.
export function startTransition(scope: () => unknown, options?: StartTransitionOptions): void {
    const prevTransition = ReactSharedInternals.T;
    const currentTransition: Transition = { types: undefined };
    ;
    ;
    ;
    ;
    ReactSharedInternals.T = currentTransition;
    try {
        const returnValue = scope();
        const onStartTransitionFinish = ReactSharedInternals.S;
        if (onStartTransitionFinish !== null) {
            onStartTransitionFinish(currentTransition, returnValue);
        }
        if (typeof returnValue === 'object' &&
            returnValue !== null &&
            typeof readProperty(returnValue as object, 'then') === 'function') {
            ;
            (returnValue as PromiseLike<unknown>).then(noop, reportGlobalError);
        }
    }
    catch (error: unknown) {
        reportGlobalError(error);
    }
    finally {
        warnAboutTransitionSubscriptions(prevTransition, currentTransition);
        if (prevTransition !== null && currentTransition.types !== null) {
            ;
            prevTransition.types = currentTransition.types;
        }
        ReactSharedInternals.T = prevTransition;
    }
}
export function startGestureTransition(provider: GestureProvider, scope: () => void, options?: GestureOptions & StartTransitionOptions): () => void {
    {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error('startGestureTransition should not be exported when the enableGestureTransition flag is off.');
    }
    ;
    ;
    ;
    ;
}
function warnAboutTransitionSubscriptions(prevTransition: Transition | null, currentTransition: Transition) {
    ;
}
