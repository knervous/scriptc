/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { adaptReducer } from 'shared/hookAdapters';
import type { Dispatcher } from 'react-reconciler/src/ReactInternalTypes';
import type { Awaited } from 'shared/ReactTypes';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';
type FormStatusNotPending = {
    pending: false;
    data: null;
    method: null;
    action: null;
};
type FormStatusPending = {
    pending: true;
    data: FormData;
    method: string;
    action: string | ((arg1: FormData) => undefined | Promise<undefined>) | null;
};
export type FormStatus = FormStatusPending | FormStatusNotPending;
// Since the "not pending" value is always the same, we can reuse the
// same object across all transitions.
const sharedNotPendingObject: FormStatusNotPending = {
    pending: false,
    data: null,
    method: null,
    action: null,
};
export const NotPending: FormStatus = sharedNotPendingObject;
function resolveDispatcher() {
    // Copied from react/src/ReactHooks.js. It's the same thing but in a
    // different package.
    const dispatcher = ReactSharedInternals.H;
    ;
    // Will result in a null access error if accessed outside render phase. We
    // intentionally don't throw our own error because this is in a hot path.
    // Also helps ensure this is inlined.
    return dispatcher as Dispatcher;
}
export function useFormStatus(): FormStatus {
    const dispatcher = resolveDispatcher();
    return dispatcher.useHostTransitionStatus();
}
export function useFormState<S, P>(action: (arg1: Awaited<S>, arg2: P) => S, initialState: Awaited<S>, permalink?: string): [
    Awaited<S>,
    (arg1: P) => void,
    boolean
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useFormState(adaptReducer(action), initialState, permalink) as [
        Awaited<S>,
        (arg1: P) => void,
        boolean
    ];
}
export function requestFormReset(form: HTMLFormElement) {
    ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .r(/* requestFormReset */ form);
}
