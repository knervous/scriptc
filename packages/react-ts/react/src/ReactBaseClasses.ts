/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import ReactNoopUpdateQueue from './ReactNoopUpdateQueue';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
const emptyObject: Record<string, unknown> = {};
;
// The update queue a component instance talks to: the reconciler's classComponentUpdater once mounted, the no-op
// queue before.
export type ComponentUpdater = {
    isMounted(publicInstance: unknown): boolean;
    enqueueSetState(publicInstance: unknown, partialState: unknown, callback?: (() => unknown) | null, callerName?: string): void;
    enqueueReplaceState(publicInstance: unknown, completeState: unknown, callback?: (() => unknown) | null, callerName?: string): void;
    enqueueForceUpdate(publicInstance: unknown, callback?: (() => unknown) | null, callerName?: string): void;
};
// The `isReactComponent` object React puts on Component.prototype (read by the reconciler's shouldConstruct).
const isReactComponentMarker = {};
/**
 * Base class helpers for the updating state of a component.
 *
 * React's function constructor with prototype methods, as a class (the methods become non-enumerable, and the
 * prototype flags are accessors on the prototype). `_reactInternals` is React's expando for the instance's fiber
 * (shared/ReactInstanceMap), declared here.
 */
class Component<P = unknown, S = unknown> {
    props: P;
    context: unknown;
    refs: Record<string, unknown>;
    updater: ComponentUpdater;
    declare state: S;
    declare _reactInternals?: Fiber;
    constructor(props: P, context?: unknown, updater?: ComponentUpdater | null) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
    }
    get isReactComponent(): object {
        return isReactComponentMarker;
    }
    /**
     * Sets a subset of the state. Always use this to mutate
     * state. You should treat `this.state` as immutable.
     */
    setState(partialState: unknown, callback?: (() => unknown) | null): void {
        if (typeof partialState !== 'object' &&
            typeof partialState !== 'function' &&
            partialState != null) {
            throw new Error('takes an object of state variables to update or a ' +
                'function which returns an object of state variables.');
        }
        this.updater.enqueueSetState(this, partialState, callback, 'setState');
    }
    /**
     * Forces an update. This should only be invoked when it is known with
     * certainty that we are **not** in a DOM transaction.
     */
    forceUpdate(callback?: (() => unknown) | null): void {
        this.updater.enqueueForceUpdate(this, callback, 'forceUpdate');
    }
}
/**
 * Convenience component with default shallow equality check for sCU.
 */
class PureComponent<P = unknown, S = unknown> extends Component<P, S> {
    get isPureReactComponent(): boolean {
        return true;
    }
}
export { Component, PureComponent };
