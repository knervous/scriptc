/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Wakeable, Thenable, FulfilledThenable, RejectedThenable, ReactDebugInfo, ReactIOInfo, } from 'shared/ReactTypes';
import { enableAsyncDebugInfo } from 'shared/ReactFeatureFlags';
import { REACT_LAZY_TYPE } from 'shared/ReactSymbols';
const Uninitialized = -1;
const Pending = 0;
const Resolved = 1;
const Rejected = 2;
type UninitializedPayload<T> = {
    _status: -1;
    _result: () => Thenable<{
        default: T;
    }>;
    _ioInfo?: ReactIOInfo; // DEV-only;
};
type PendingPayload = {
    _status: 0;
    _result: Wakeable;
    _ioInfo?: ReactIOInfo; // DEV-only;
};
type ResolvedPayload<T> = {
    _status: 1;
    _result: {
        default: T;
    };
    _ioInfo?: ReactIOInfo; // DEV-only;
};
type RejectedPayload = {
    _status: 2;
    _result: unknown;
    _ioInfo?: ReactIOInfo; // DEV-only;
};
type Payload<T> = UninitializedPayload<T> | PendingPayload | ResolvedPayload<T> | RejectedPayload;
export type LazyComponent<T, P> = {
    $$typeof: symbol | number;
    _payload: P;
    _init: (payload: P) => T;
    // __DEV__
    _debugInfo?: null | ReactDebugInfo;
    _store?: {
        validated: 0 | 1 | 2;
    }; // 0: not validated, 1: validated, 2: force fail;
};
function lazyInitializer<T>(payload: Payload<T>): T {
    if (payload._status === Uninitialized) {
        ;
        const ctor = payload._result;
        const thenable = ctor();
        // Transition to the next state.
        // This might throw either because it's missing or throws. If so, we treat it
        // as still uninitialized and try again next time. Which is the same as what
        // happens if the ctor or any wrappers processing the ctor throws. This might
        // end up fixing it if the resolution was a concurrency bug.
        thenable.then((moduleObject) => {
            if ((payload as Payload<T>)._status === Pending ||
                payload._status === Uninitialized) {
                // Transition to the next state.
                const resolved: ResolvedPayload<T> = (payload as Payload<T> as ResolvedPayload<T>);
                resolved._status = Resolved;
                resolved._result = moduleObject as { default: T }; // the module the thenable resolved to
                ;
            }
        }, (error) => {
            if ((payload as Payload<T>)._status === Pending ||
                payload._status === Uninitialized) {
                // Transition to the next state.
                const rejected: RejectedPayload = (payload as Payload<T> as RejectedPayload);
                rejected._status = Rejected;
                rejected._result = error;
                ;
            }
        });
        ;
        if (payload._status === Uninitialized) {
            // In case, we're still uninitialized, then we're waiting for the thenable
            // to resolve. Set it as pending in the meantime.
            const pending: PendingPayload = (payload as Payload<T> as PendingPayload);
            pending._status = Pending;
            pending._result = thenable;
        }
    }
    if (payload._status === Resolved) {
        const moduleObject = payload._result;
        ;
        ;
        return moduleObject.default;
    }
    else {
        throw payload._result;
    }
}
export function lazy<T>(ctor: () => Thenable<{
    default: T;
}>): LazyComponent<T, Payload<T>> {
    const payload: Payload<T> = {
        // We use these fields to store the result.
        _status: Uninitialized,
        _result: ctor,
    };
    const lazyType: LazyComponent<T, Payload<T>> = {
        $$typeof: REACT_LAZY_TYPE,
        _payload: payload,
        _init: lazyInitializer,
    };
    ;
    return lazyType;
}
