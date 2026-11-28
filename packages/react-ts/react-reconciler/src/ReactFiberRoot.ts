/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ReactNodeList, ReactFormState } from 'shared/ReactTypes';
import type { Fiber, FiberRoot, SuspenseHydrationCallbacks, TransitionTracingCallbacks, } from './ReactInternalTypes';
import type { RootTag } from './ReactRootTags';
import type { Cache } from './ReactFiberCacheComponent';
import type { Container } from './ReactFiberConfig';
import { noTimeout } from './ReactFiberConfig';
import { createHostRootFiber } from './ReactFiber';
import { NoLane, NoLanes, NoTimestamp, TotalLanes, createLaneMap, } from './ReactFiberLane';
import { enableSuspenseCallback, enableProfilerCommitHooks, enableProfilerTimer, enableUpdaterTracking, enableTransitionTracing, disableLegacyMode, enableViewTransition, enableGestureTransition, enableDefaultTransitionIndicator, } from 'shared/ReactFeatureFlags';
import { initializeUpdateQueue } from './ReactFiberClassUpdateQueue';
import { LegacyRoot, ConcurrentRoot } from './ReactRootTags';
import { createCache, retainCache } from './ReactFiberCacheComponent';
export type RootState = {
    element: any;
    isDehydrated: boolean;
    cache: Cache;
};
// React's FiberRootNode function constructor as a class with the same fields, assigned in the same order.
class FiberRootNode implements FiberRoot {
    tag: FiberRoot['tag'];
    containerInfo: FiberRoot['containerInfo'];
    pendingChildren: FiberRoot['pendingChildren'];
    current: FiberRoot['current'];
    pingCache: FiberRoot['pingCache'];
    timeoutHandle: FiberRoot['timeoutHandle'];
    cancelPendingCommit: FiberRoot['cancelPendingCommit'];
    context: FiberRoot['context'];
    pendingContext: FiberRoot['pendingContext'];
    next: FiberRoot['next'];
    callbackNode: FiberRoot['callbackNode'];
    callbackPriority: FiberRoot['callbackPriority'];
    expirationTimes: FiberRoot['expirationTimes'];
    pendingLanes: FiberRoot['pendingLanes'];
    suspendedLanes: FiberRoot['suspendedLanes'];
    pingedLanes: FiberRoot['pingedLanes'];
    warmLanes: FiberRoot['warmLanes'];
    expiredLanes: FiberRoot['expiredLanes'];
    errorRecoveryDisabledLanes: FiberRoot['errorRecoveryDisabledLanes'];
    shellSuspendCounter: FiberRoot['shellSuspendCounter'];
    entangledLanes: FiberRoot['entangledLanes'];
    entanglements: FiberRoot['entanglements'];
    hiddenUpdates: FiberRoot['hiddenUpdates'];
    identifierPrefix: FiberRoot['identifierPrefix'];
    onUncaughtError: FiberRoot['onUncaughtError'];
    onCaughtError: FiberRoot['onCaughtError'];
    onRecoverableError: FiberRoot['onRecoverableError'];
    pooledCache: FiberRoot['pooledCache'];
    pooledCacheLanes: FiberRoot['pooledCacheLanes'];
    formState: FiberRoot['formState'];
    incompleteTransitions: FiberRoot['incompleteTransitions'];
    // `current` is the root's HostRoot fiber, created first (React assigns it right after construction).
    constructor(current: Fiber, containerInfo: FiberRoot['containerInfo'], tag: RootTag, hydrate: boolean, identifierPrefix: FiberRoot['identifierPrefix'], onUncaughtError: FiberRoot['onUncaughtError'], onCaughtError: FiberRoot['onCaughtError'], onRecoverableError: FiberRoot['onRecoverableError'], onDefaultTransitionIndicator: () => undefined | (() => void), formState: FiberRoot['formState']) {
        this.tag = ConcurrentRoot;
        this.containerInfo = containerInfo;
        this.pendingChildren = null;
        this.current = current;
        this.pingCache = null;
        this.timeoutHandle = noTimeout;
        this.cancelPendingCommit = null;
        this.context = null;
        this.pendingContext = null;
        this.next = null;
        this.callbackNode = null;
        this.callbackPriority = NoLane;
        this.expirationTimes = createLaneMap(NoTimestamp);
        this.pendingLanes = NoLanes;
        this.suspendedLanes = NoLanes;
        this.pingedLanes = NoLanes;
        this.warmLanes = NoLanes;
        this.expiredLanes = NoLanes;
        ;
        this.errorRecoveryDisabledLanes = NoLanes;
        this.shellSuspendCounter = 0;
        this.entangledLanes = NoLanes;
        this.entanglements = createLaneMap(NoLanes);
        this.hiddenUpdates = createLaneMap(null);
        this.identifierPrefix = identifierPrefix;
        this.onUncaughtError = onUncaughtError;
        this.onCaughtError = onCaughtError;
        this.onRecoverableError = onRecoverableError;
        ;
        this.pooledCache = null;
        this.pooledCacheLanes = NoLanes;
        ;
        this.formState = formState;
        ;
        ;
        this.incompleteTransitions = new Map();
        ;
        ;
        ;
        ;
    }
}
export function createFiberRoot(containerInfo: Container, tag: RootTag, hydrate: boolean, initialChildren: ReactNodeList, hydrationCallbacks: null | SuspenseHydrationCallbacks, isStrictMode: boolean, 
// TODO: We have several of these arguments that are conceptually part of the
// host config, but because they are passed in at runtime, we have to thread
// them through the root constructor. Perhaps we should put them all into a
// single type, like a DynamicHostConfig that is defined by the renderer.
identifierPrefix: string, formState: ReactFormState<any, any> | null, onUncaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onCaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
    readonly errorBoundary?: object | null | undefined; // the boundary class instance
}) => void, onRecoverableError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onDefaultTransitionIndicator: () => undefined | (() => void), transitionCallbacks: null | TransitionTracingCallbacks): FiberRoot {
    // Cyclic construction: the HostRoot fiber is created first and handed to the root.
    const uninitializedFiber = createHostRootFiber(tag, isStrictMode);
    const root: FiberRoot = new FiberRootNode(uninitializedFiber, containerInfo, tag, hydrate, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, formState);
    uninitializedFiber.stateNode = root;
    const initialCache = createCache();
    retainCache(initialCache);
    // The pooledCache is a fresh cache instance that is used temporarily
    // for newly mounted boundaries during a render. In general, the
    // pooledCache is always cleared from the root at the end of a render:
    // it is either released when render commits, or moved to an Offscreen
    // component if rendering suspends. Because the lifetime of the pooled
    // cache is distinct from the main memoizedState.cache, it must be
    // retained separately.
    root.pooledCache = initialCache;
    retainCache(initialCache);
    const initialState: RootState = {
        element: initialChildren,
        isDehydrated: hydrate,
        cache: initialCache,
    };
    uninitializedFiber.memoizedState = initialState;
    initializeUpdateQueue(uninitializedFiber);
    return root;
}
