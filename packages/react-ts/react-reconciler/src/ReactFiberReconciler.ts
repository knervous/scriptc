/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
import { get as getInstance } from 'shared/ReactInstanceMap';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import type { ReactFormState,ReactNodeList } from 'shared/ReactTypes';
import ReactVersion from 'shared/ReactVersion';
import type { ActivityState } from './ReactFiberActivityComponent';
import { registerDefaultIndicator } from './ReactFiberAsyncAction';
import { createUpdate,enqueueUpdate,entangleTransitions } from './ReactFiberClassUpdateQueue';
import { enqueueConcurrentRenderForLane } from './ReactFiberConcurrentUpdates';
import type { Container,PublicInstance,RendererInspectionConfig } from './ReactFiberConfig';
import { extraDevToolsConfig,getPublicInstance,rendererPackageName,rendererVersion } from './ReactFiberConfig';
import { injectInternals } from './ReactFiberDevToolsHook';
import type { Lane } from './ReactFiberLane';
import { getBumpedLaneForHydrationByLane,getHighestPriorityPendingLanes,higherPriorityLane,SelectiveHydrationLane,SyncLane } from './ReactFiberLane';
import { emptyContextObject,findCurrentUnmaskedContext,isContextProvider as isLegacyContextProvider,processChildContext } from './ReactFiberLegacyContext';
import { createFiberRoot } from './ReactFiberRoot';
import { isRootDehydrated } from './ReactFiberShellHydration';
import type { SuspenseState } from './ReactFiberSuspenseComponent';
import { findCurrentHostFiber } from './ReactFiberTreeReflection';
import { batchedUpdates,deferredUpdates,discreteUpdates,flushPendingEffects,flushRoot,flushSyncFromReconciler,flushSyncWork,isAlreadyRendering,requestUpdateLane,scheduleInitialHydrationOnRoot,scheduleUpdateOnFiber } from './ReactFiberWorkLoop';
import type { Fiber,FiberRoot,SuspenseHydrationCallbacks,TransitionTracingCallbacks } from './ReactInternalTypes';
import { startUpdateTimerByLane } from './ReactProfilerTimer';
import type { RootTag } from './ReactRootTags';
import { ActivityComponent,ClassComponent,HostRoot,SuspenseComponent } from './ReactWorkTags';
export { defaultOnCaughtError,defaultOnRecoverableError,defaultOnUncaughtError } from './ReactFiberErrorLogger';
export { startHostTransition } from './ReactFiberHooks';
export { createPortal } from './ReactPortal';
export { createComponentSelector,createHasPseudoClassSelector,createRoleSelector,createTestNameSelector,createTextSelector,findAllNodes,findBoundingRects,focusWithin,getFindAllNodesFailureDescription,observeVisibleRects } from './ReactTestSelectors';
export { batchedUpdates,deferredUpdates,discreteUpdates,flushSyncFromReconciler,flushSyncWork,isAlreadyRendering,flushPendingEffects as flushPassiveEffects,};
export { findHostInstance };
export { findHostInstanceWithWarning };
type OpaqueRoot = FiberRoot;
;
// The parent is a mounted class component instance (legacy context).
function getContextForSubtree(parentComponent?: object | null): Record<any, any> {
    if (!parentComponent) {
        return emptyContextObject;
    }
    const fiber = getInstance(parentComponent)!;
    const parentContext = findCurrentUnmaskedContext(fiber);
    if (fiber.tag === ClassComponent) {
        const Component = fiber.type;
        if (isLegacyContextProvider(Component)) {
            return processChildContext(fiber, Component, parentContext);
        }
    }
    return parentContext;
}
function findHostInstance(component: object): PublicInstance | null {
    const fiber = getInstance(component);
    if (fiber === undefined) {
        if (typeof readProperty(component as object, 'render') === 'function') {
            throw new Error('Unable to find node on an unmounted component.');
        }
        else {
            const keys = Object.keys(component).join(',');
            throw new Error(`Argument appears to not be a ReactComponent. Keys: ${keys}`);
        }
    }
    const hostFiber = findCurrentHostFiber(fiber);
    if (hostFiber === null) {
        return null;
    }
    return getPublicInstance(hostFiber.stateNode);
}
function findHostInstanceWithWarning(component: Record<any, any>, methodName: string): PublicInstance | null {
    ;
    return findHostInstance(component);
}
export function createContainer(containerInfo: Container, tag: RootTag, hydrationCallbacks: null | SuspenseHydrationCallbacks, isStrictMode: boolean, 
// TODO: Remove `concurrentUpdatesByDefaultOverride`. It is now ignored.
concurrentUpdatesByDefaultOverride: null | boolean, identifierPrefix: string, onUncaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onCaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
    readonly errorBoundary?: object | null | undefined; // the boundary class instance
}) => void, onRecoverableError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onDefaultTransitionIndicator: () => undefined | (() => void), transitionCallbacks: null | TransitionTracingCallbacks): OpaqueRoot {
    const hydrate = false;
    const initialChildren = null;
    const root = createFiberRoot(containerInfo, tag, hydrate, initialChildren, hydrationCallbacks, isStrictMode, identifierPrefix, null, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, transitionCallbacks);
    registerDefaultIndicator(onDefaultTransitionIndicator);
    return root;
}
export function createHydrationContainer(initialChildren: ReactNodeList, 
// TODO: Remove `callback` when we delete legacy mode.
callback: (() => unknown) | null | undefined, containerInfo: Container, tag: RootTag, hydrationCallbacks: null | SuspenseHydrationCallbacks, isStrictMode: boolean, 
// TODO: Remove `concurrentUpdatesByDefaultOverride`. It is now ignored.
concurrentUpdatesByDefaultOverride: null | boolean, identifierPrefix: string, onUncaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onCaughtError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
    readonly errorBoundary?: object | null | undefined; // the boundary class instance
}) => void, onRecoverableError: (error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) => void, onDefaultTransitionIndicator: () => undefined | (() => void), transitionCallbacks: null | TransitionTracingCallbacks, formState: ReactFormState<any, any> | null): OpaqueRoot {
    const hydrate = true;
    const root = createFiberRoot(containerInfo, tag, hydrate, initialChildren, hydrationCallbacks, isStrictMode, identifierPrefix, formState, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, transitionCallbacks);
    registerDefaultIndicator(onDefaultTransitionIndicator);
    // TODO: Move this to FiberRoot constructor
    root.context = getContextForSubtree(null);
    // Schedule the initial render. In a hydration root, this is different from
    // a regular update because the initial render must match was was rendered
    // on the server.
    // NOTE: This update intentionally doesn't have a payload. We're only using
    // the update to schedule work on the root fiber (and, for legacy roots, to
    // enqueue the callback if one is provided).
    const current = root.current;
    let lane = requestUpdateLane(current);
    {
        lane = getBumpedLaneForHydrationByLane(lane);
    }
    const update = createUpdate(lane);
    update.callback =
        callback !== undefined && callback !== null ? callback : null;
    enqueueUpdate(current, update, lane);
    startUpdateTimerByLane(lane, 'hydrateRoot()', null);
    scheduleInitialHydrationOnRoot(root, lane);
    return root;
}
export function updateContainer(element: ReactNodeList, container: OpaqueRoot, parentComponent?: object | null, callback?: (() => unknown) | null): Lane {
    const current = container.current;
    const lane = requestUpdateLane(current);
    updateContainerImpl(current, lane, element, container, parentComponent, callback);
    return lane;
}
export function updateContainerSync(element: ReactNodeList, container: OpaqueRoot, parentComponent?: object | null, callback?: (() => unknown) | null): Lane {
    ;
    const current = container.current;
    updateContainerImpl(current, SyncLane, element, container, parentComponent, callback);
    return SyncLane;
}
function updateContainerImpl(rootFiber: Fiber, lane: Lane, element: ReactNodeList, container: OpaqueRoot, parentComponent?: object | null, callback?: (() => unknown) | null): void {
    ;
    ;
    const context = getContextForSubtree(parentComponent);
    if (container.context === null) {
        container.context = context;
    }
    else {
        container.pendingContext = context;
    }
    ;
    const update = createUpdate(lane);
    // Caution: React DevTools currently depends on this property
    // being called "element".
    update.payload = { element };
    callback = callback === undefined ? null : callback;
    if (callback !== null) {
        ;
        update.callback = callback;
    }
    const root = enqueueUpdate(rootFiber, update, lane);
    if (root !== null) {
        startUpdateTimerByLane(lane, 'root.render()', null);
        scheduleUpdateOnFiber(root, rootFiber, lane);
        entangleTransitions(root, rootFiber, lane);
    }
}
export function attemptSynchronousHydration(fiber: Fiber): void {
    switch (fiber.tag) {
        case HostRoot: {
            const root: FiberRoot = fiber.stateNode;
            if (isRootDehydrated(root)) {
                // Flush the first scheduled "update".
                const lanes = getHighestPriorityPendingLanes(root);
                flushRoot(root, lanes);
            }
            break;
        }
        case ActivityComponent:
        case SuspenseComponent: {
            const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
            if (root !== null) {
                scheduleUpdateOnFiber(root, fiber, SyncLane);
            }
            flushSyncWork();
            // If we're still blocked after this, we need to increase
            // the priority of any promises resolving within this
            // boundary so that they next attempt also has higher pri.
            const retryLane = SyncLane;
            markRetryLaneIfNotHydrated(fiber, retryLane);
            break;
        }
    }
}
function markRetryLaneImpl(fiber: Fiber, retryLane: Lane) {
    const suspenseState: null | SuspenseState | ActivityState = fiber.memoizedState;
    if (suspenseState !== null && suspenseState.dehydrated !== null) {
        suspenseState.retryLane = higherPriorityLane(suspenseState.retryLane, retryLane);
    }
}
// Increases the priority of thenables when they resolve within this boundary.
function markRetryLaneIfNotHydrated(fiber: Fiber, retryLane: Lane) {
    markRetryLaneImpl(fiber, retryLane);
    const alternate = fiber.alternate;
    if (alternate) {
        markRetryLaneImpl(alternate, retryLane);
    }
}
export function attemptContinuousHydration(fiber: Fiber): void {
    if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
        // We ignore HostRoots here because we can't increase
        // their priority and they should not suspend on I/O,
        // since you have to wrap anything that might suspend in
        // Suspense.
        return;
    }
    const lane = SelectiveHydrationLane;
    const root = enqueueConcurrentRenderForLane(fiber, lane);
    if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, lane);
    }
    markRetryLaneIfNotHydrated(fiber, lane);
}
export function attemptHydrationAtCurrentPriority(fiber: Fiber): void {
    if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
        // We ignore HostRoots here because we can't increase
        // their priority other than synchronously flush it.
        return;
    }
    let lane = requestUpdateLane(fiber);
    {
        lane = getBumpedLaneForHydrationByLane(lane);
    }
    const root = enqueueConcurrentRenderForLane(fiber, lane);
    if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, lane);
    }
    markRetryLaneIfNotHydrated(fiber, lane);
}
;
export function injectIntoDevTools(): boolean {
    const internals: Record<any, any> = {
        bundleType: 0,
        version: rendererVersion,
        rendererPackageName: rendererPackageName,
        currentDispatcherRef: ReactSharedInternals,
        // Enables DevTools to detect reconciler version rather than renderer version
        // which may not match for third party renderers.
        reconcilerVersion: ReactVersion,
    };
    if (extraDevToolsConfig !== null) {
        internals.rendererConfig = (extraDevToolsConfig as RendererInspectionConfig);
    }
    ;
    ;
    return injectInternals(internals);
}
