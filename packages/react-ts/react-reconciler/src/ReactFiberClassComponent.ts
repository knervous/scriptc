/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Component } from 'react/src/ReactBaseClasses';
import assign from 'shared/assign';
import { get as getInstance,set as setInstance } from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import type { UpdateQueue } from './ReactFiberClassUpdateQueue';
import { checkHasForceUpdateAfterProcessing,cloneUpdateQueue,createUpdate,enqueueUpdate,entangleTransitions,ForceUpdate,initializeUpdateQueue,processUpdateQueue,ReplaceState,resetHasForceUpdateBeforeProcessing,suspendIfUpdateReadFromEntangledAsyncAction } from './ReactFiberClassUpdateQueue';
import { LayoutStatic,Snapshot,Update } from './ReactFiberFlags';
import type { Lanes } from './ReactFiberLane';
import { NoLanes } from './ReactFiberLane';
import { cacheContext,emptyContextObject,hasContextChanged } from './ReactFiberLegacyContext';
import { checkIfContextChanged,readContext } from './ReactFiberNewContext';
import { requestUpdateLane,scheduleUpdateOnFiber } from './ReactFiberWorkLoop';
import type { Fiber } from './ReactInternalTypes';
import { startUpdateTimerByLane } from './ReactProfilerTimer';
;
function applyDerivedStateFromProps(workInProgress: Fiber, ctor: unknown, getDerivedStateFromProps: (props?: unknown, state?: unknown) => any, nextProps: unknown) {
    const prevState = workInProgress.memoizedState;
    let partialState = getDerivedStateFromProps(nextProps, prevState);
    ;
    // Merge the partial state and the previous state.
    const memoizedState = partialState === null || partialState === undefined
        ? prevState
        : assign(assign({}, prevState), partialState);
    workInProgress.memoizedState = memoizedState;
    // Once the update queue is empty, persist the derived state onto the
    // base state.
    if (workInProgress.lanes === NoLanes) {
        // Queue is always non-null for classes
        const updateQueue: UpdateQueue<unknown> = (workInProgress.updateQueue as UpdateQueue<unknown>);
        updateQueue.baseState = memoizedState;
    }
}
const classComponentUpdater = {
    enqueueSetState(inst: Component, payload: unknown, callback: unknown) {
        // The updater is installed on mounted instances only.
        const fiber = getInstance(inst)!;
        const lane = requestUpdateLane(fiber);
        const update = createUpdate(lane);
        update.payload = payload;
        if (callback !== undefined && callback !== null) {
            ;
            update.callback = callback as () => unknown;
        }
        const root = enqueueUpdate(fiber, update, lane);
        if (root !== null) {
            startUpdateTimerByLane(lane, 'this.setState()', fiber);
            scheduleUpdateOnFiber(root, fiber, lane);
            entangleTransitions(root, fiber, lane);
        }
        ;
    },
    enqueueReplaceState(inst: Component, payload: unknown, callback: null) {
        // The updater is installed on mounted instances only.
        const fiber = getInstance(inst)!;
        const lane = requestUpdateLane(fiber);
        const update = createUpdate(lane);
        update.tag = ReplaceState;
        update.payload = payload;
        if (callback !== undefined && callback !== null) {
            ;
            update.callback = callback as () => unknown;
        }
        const root = enqueueUpdate(fiber, update, lane);
        if (root !== null) {
            startUpdateTimerByLane(lane, 'this.replaceState()', fiber);
            scheduleUpdateOnFiber(root, fiber, lane);
            entangleTransitions(root, fiber, lane);
        }
        ;
    },
    enqueueForceUpdate(inst: Component, callback: unknown) {
        // The updater is installed on mounted instances only.
        const fiber = getInstance(inst)!;
        const lane = requestUpdateLane(fiber);
        const update = createUpdate(lane);
        update.tag = ForceUpdate;
        if (callback !== undefined && callback !== null) {
            ;
            update.callback = callback as () => unknown;
        }
        const root = enqueueUpdate(fiber, update, lane);
        if (root !== null) {
            startUpdateTimerByLane(lane, 'this.forceUpdate()', fiber);
            scheduleUpdateOnFiber(root, fiber, lane);
            entangleTransitions(root, fiber, lane);
        }
        ;
    },
} as const;
function checkShouldComponentUpdate(workInProgress: Fiber, ctor: any, oldProps: unknown, newProps: unknown, oldState: unknown, newState: unknown, nextContext: unknown) {
    const instance = workInProgress.stateNode;
    if (typeof instance.shouldComponentUpdate === 'function') {
        let shouldUpdate = instance.shouldComponentUpdate(newProps, newState, nextContext);
        ;
        return shouldUpdate;
    }
    if (ctor.prototype && ctor.prototype.isPureReactComponent) {
        return (!shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState));
    }
    return true;
}
function constructClassInstance(workInProgress: Fiber, ctor: any, props: unknown): any {
    let isLegacyContextConsumer = false;
    let unmaskedContext = emptyContextObject;
    let context = emptyContextObject;
    const contextType = ctor.contextType;
    ;
    if (typeof contextType === 'object' && contextType !== null) {
        context = readContext((contextType));
    }
    else
        ;
    let instance = new ctor(props, context);
    ;
    const state = (workInProgress.memoizedState =
        instance.state !== null && instance.state !== undefined
            ? instance.state
            : null);
    instance.updater = classComponentUpdater;
    workInProgress.stateNode = instance;
    // The instance needs access to the fiber so that it can schedule updates
    setInstance(instance, workInProgress);
    ;
    ;
    // Cache unmasked context so we can avoid recreating masked context unless necessary.
    // ReactFiberLegacyContext usually updates this cache but can't for newly-created instances.
    if (isLegacyContextConsumer) {
        cacheContext(workInProgress, unmaskedContext, context);
    }
    return instance;
}
function callComponentWillMount(workInProgress: Fiber, instance: any) {
    const oldState = instance.state;
    if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
    }
    if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
    }
    if (oldState !== instance.state) {
        ;
        classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
    }
}
function callComponentWillReceiveProps(workInProgress: Fiber, instance: any, newProps: unknown, nextContext: unknown) {
    const oldState = instance.state;
    if (typeof instance.componentWillReceiveProps === 'function') {
        instance.componentWillReceiveProps(newProps, nextContext);
    }
    if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
        instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
    }
    if (instance.state !== oldState) {
        ;
        classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
    }
}
// Invokes the mount life-cycles on a previously never rendered instance.
function mountClassInstance(workInProgress: Fiber, ctor: any, newProps: unknown, renderLanes: Lanes): void {
    ;
    const instance = workInProgress.stateNode;
    instance.props = newProps;
    instance.state = workInProgress.memoizedState;
    instance.refs = {};
    initializeUpdateQueue(workInProgress);
    const contextType = ctor.contextType;
    if (typeof contextType === 'object' && contextType !== null) {
        instance.context = readContext(contextType);
    }
    else {
        instance.context = emptyContextObject;
    }
    ;
    instance.state = workInProgress.memoizedState;
    const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
    if (typeof getDerivedStateFromProps === 'function') {
        applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps, newProps);
        instance.state = workInProgress.memoizedState;
    }
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (typeof ctor.getDerivedStateFromProps !== 'function' &&
        typeof instance.getSnapshotBeforeUpdate !== 'function' &&
        (typeof instance.UNSAFE_componentWillMount === 'function' ||
            typeof instance.componentWillMount === 'function')) {
        callComponentWillMount(workInProgress, instance);
        // If we had additional state updates during this life-cycle, let's
        // process them now.
        processUpdateQueue(workInProgress, newProps, instance, renderLanes);
        suspendIfUpdateReadFromEntangledAsyncAction();
        instance.state = workInProgress.memoizedState;
    }
    if (typeof instance.componentDidMount === 'function') {
        workInProgress.flags |= Update | LayoutStatic;
    }
    ;
}
function resumeMountClassInstance(workInProgress: Fiber, ctor: any, newProps: unknown, renderLanes: Lanes): boolean {
    const instance = workInProgress.stateNode;
    const unresolvedOldProps = workInProgress.memoizedProps;
    const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
    instance.props = oldProps;
    const oldContext = instance.context;
    const contextType = ctor.contextType;
    let nextContext = emptyContextObject;
    if (typeof contextType === 'object' && contextType !== null) {
        nextContext = readContext(contextType);
    }
    else
        ;
    const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
    const hasNewLifecycles = typeof getDerivedStateFromProps === 'function' ||
        typeof instance.getSnapshotBeforeUpdate === 'function';
    // When comparing whether props changed, we should compare using the
    // unresolved props object that is stored on the fiber, rather than the
    // one that gets assigned to the instance, because that object may have been
    // cloned to resolve default props and/or remove `ref`.
    const unresolvedNewProps = workInProgress.pendingProps;
    const didReceiveNewProps = unresolvedNewProps !== unresolvedOldProps;
    // Note: During these life-cycles, instance.props/instance.state are what
    // ever the previously attempted to render - not the "current". However,
    // during componentDidUpdate we pass the "current" props.
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (!hasNewLifecycles &&
        (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
            typeof instance.componentWillReceiveProps === 'function')) {
        if (didReceiveNewProps || oldContext !== nextContext) {
            callComponentWillReceiveProps(workInProgress, instance, newProps, nextContext);
        }
    }
    resetHasForceUpdateBeforeProcessing();
    const oldState = workInProgress.memoizedState;
    let newState = (instance.state = oldState);
    processUpdateQueue(workInProgress, newProps, instance, renderLanes);
    suspendIfUpdateReadFromEntangledAsyncAction();
    newState = workInProgress.memoizedState;
    if (!didReceiveNewProps &&
        oldState === newState &&
        !hasContextChanged() &&
        !checkHasForceUpdateAfterProcessing()) {
        // If an update was already in progress, we should schedule an Update
        // effect even though we're bailing out, so that cWU/cDU are called.
        if (typeof instance.componentDidMount === 'function') {
            workInProgress.flags |= Update | LayoutStatic;
        }
        ;
        return false;
    }
    if (typeof getDerivedStateFromProps === 'function') {
        applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps, newProps);
        newState = workInProgress.memoizedState;
    }
    const shouldUpdate = checkHasForceUpdateAfterProcessing() ||
        checkShouldComponentUpdate(workInProgress, ctor, oldProps, newProps, oldState, newState, nextContext);
    if (shouldUpdate) {
        // In order to support react-lifecycles-compat polyfilled components,
        // Unsafe lifecycles should not be invoked for components using the new APIs.
        if (!hasNewLifecycles &&
            (typeof instance.UNSAFE_componentWillMount === 'function' ||
                typeof instance.componentWillMount === 'function')) {
            if (typeof instance.componentWillMount === 'function') {
                instance.componentWillMount();
            }
            if (typeof instance.UNSAFE_componentWillMount === 'function') {
                instance.UNSAFE_componentWillMount();
            }
        }
        if (typeof instance.componentDidMount === 'function') {
            workInProgress.flags |= Update | LayoutStatic;
        }
        ;
    }
    else {
        // If an update was already in progress, we should schedule an Update
        // effect even though we're bailing out, so that cWU/cDU are called.
        if (typeof instance.componentDidMount === 'function') {
            workInProgress.flags |= Update | LayoutStatic;
        }
        ;
        // If shouldComponentUpdate returned false, we should still update the
        // memoized state to indicate that this work can be reused.
        workInProgress.memoizedProps = newProps;
        workInProgress.memoizedState = newState;
    }
    // Update the existing instance's state, props, and context pointers even
    // if shouldComponentUpdate returns false.
    instance.props = newProps;
    instance.state = newState;
    instance.context = nextContext;
    return shouldUpdate;
}
// Invokes the update life-cycles and returns false if it shouldn't rerender.
function updateClassInstance(current: Fiber, workInProgress: Fiber, ctor: any, newProps: unknown, renderLanes: Lanes): boolean {
    const instance = workInProgress.stateNode;
    cloneUpdateQueue(current, workInProgress);
    const unresolvedOldProps = workInProgress.memoizedProps;
    const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
    instance.props = oldProps;
    const unresolvedNewProps = workInProgress.pendingProps;
    const oldContext = instance.context;
    const contextType = ctor.contextType;
    let nextContext = emptyContextObject;
    if (typeof contextType === 'object' && contextType !== null) {
        nextContext = readContext(contextType);
    }
    else
        ;
    const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
    const hasNewLifecycles = typeof getDerivedStateFromProps === 'function' ||
        typeof instance.getSnapshotBeforeUpdate === 'function';
    // Note: During these life-cycles, instance.props/instance.state are what
    // ever the previously attempted to render - not the "current". However,
    // during componentDidUpdate we pass the "current" props.
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (!hasNewLifecycles &&
        (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
            typeof instance.componentWillReceiveProps === 'function')) {
        if (unresolvedOldProps !== unresolvedNewProps ||
            oldContext !== nextContext) {
            callComponentWillReceiveProps(workInProgress, instance, newProps, nextContext);
        }
    }
    resetHasForceUpdateBeforeProcessing();
    const oldState = workInProgress.memoizedState;
    let newState = (instance.state = oldState);
    processUpdateQueue(workInProgress, newProps, instance, renderLanes);
    suspendIfUpdateReadFromEntangledAsyncAction();
    newState = workInProgress.memoizedState;
    if (unresolvedOldProps === unresolvedNewProps &&
        oldState === newState &&
        !hasContextChanged() &&
        !checkHasForceUpdateAfterProcessing() &&
        !(current !== null &&
            current.dependencies !== null &&
            checkIfContextChanged(current.dependencies))) {
        // If an update was already in progress, we should schedule an Update
        // effect even though we're bailing out, so that cWU/cDU are called.
        if (typeof instance.componentDidUpdate === 'function') {
            if (unresolvedOldProps !== current.memoizedProps ||
                oldState !== current.memoizedState) {
                workInProgress.flags |= Update;
            }
        }
        if (typeof instance.getSnapshotBeforeUpdate === 'function') {
            if (unresolvedOldProps !== current.memoizedProps ||
                oldState !== current.memoizedState) {
                workInProgress.flags |= Snapshot;
            }
        }
        return false;
    }
    if (typeof getDerivedStateFromProps === 'function') {
        applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps, newProps);
        newState = workInProgress.memoizedState;
    }
    const shouldUpdate = checkHasForceUpdateAfterProcessing() ||
        checkShouldComponentUpdate(workInProgress, ctor, oldProps, newProps, oldState, newState, nextContext) ||
        // TODO: In some cases, we'll end up checking if context has changed twice,
        // both before and after `shouldComponentUpdate` has been called. Not ideal,
        // but I'm loath to refactor this function. This only happens for memoized
        // components so it's not that common.
        (current !== null &&
            current.dependencies !== null &&
            checkIfContextChanged(current.dependencies));
    if (shouldUpdate) {
        // In order to support react-lifecycles-compat polyfilled components,
        // Unsafe lifecycles should not be invoked for components using the new APIs.
        if (!hasNewLifecycles &&
            (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
                typeof instance.componentWillUpdate === 'function')) {
            if (typeof instance.componentWillUpdate === 'function') {
                instance.componentWillUpdate(newProps, newState, nextContext);
            }
            if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
                instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
            }
        }
        if (typeof instance.componentDidUpdate === 'function') {
            workInProgress.flags |= Update;
        }
        if (typeof instance.getSnapshotBeforeUpdate === 'function') {
            workInProgress.flags |= Snapshot;
        }
    }
    else {
        // If an update was already in progress, we should schedule an Update
        // effect even though we're bailing out, so that cWU/cDU are called.
        if (typeof instance.componentDidUpdate === 'function') {
            if (unresolvedOldProps !== current.memoizedProps ||
                oldState !== current.memoizedState) {
                workInProgress.flags |= Update;
            }
        }
        if (typeof instance.getSnapshotBeforeUpdate === 'function') {
            if (unresolvedOldProps !== current.memoizedProps ||
                oldState !== current.memoizedState) {
                workInProgress.flags |= Snapshot;
            }
        }
        // If shouldComponentUpdate returned false, we should still update the
        // memoized props/state to indicate that this work can be reused.
        workInProgress.memoizedProps = newProps;
        workInProgress.memoizedState = newState;
    }
    // Update the existing instance's state, props, and context pointers even
    // if shouldComponentUpdate returns false.
    instance.props = newProps;
    instance.state = newState;
    instance.context = nextContext;
    return shouldUpdate;
}
export function resolveClassComponentProps(Component: any, baseProps: Record<any, any>): Record<any, any> {
    let newProps = baseProps;
    // Remove ref from the props object, if it exists.
    if ('ref' in baseProps) {
        newProps = (({}));
        for (const propName in baseProps) {
            if (propName !== 'ref') {
                newProps[propName] = baseProps[propName];
            }
        }
    }
    // Resolve default props.
    const defaultProps = Component.defaultProps;
    if (defaultProps) {
        // We may have already copied the props object above to remove ref. If so,
        // we can modify that. Otherwise, copy the props object with Object.assign.
        if (newProps === baseProps) {
            newProps = assign({}, newProps);
        }
        // Taken from old JSX runtime, where this used to live.
        for (const propName in defaultProps) {
            if (newProps[propName] === undefined) {
                newProps[propName] = defaultProps[propName];
            }
        }
    }
    return newProps;
}
export { constructClassInstance,mountClassInstance,resumeMountClassInstance,updateClassInstance,};
