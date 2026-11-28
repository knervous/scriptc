/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Task } from 'scheduler/src/forks/Scheduler';
import type { RefObject, ReactContext, StartTransitionOptions, Wakeable, Usable, ReactFormState, Awaited, ReactComponentInfo, ReactDebugInfo, } from 'shared/ReactTypes';
import type { TransitionTypes } from 'react/src/ReactTransitionType';
import type { WorkTag } from './ReactWorkTags';
import type { TypeOfMode } from './ReactTypeOfMode';
import type { Flags } from './ReactFiberFlags';
import type { Lane, Lanes, LaneMap } from './ReactFiberLane';
import type { RootTag } from './ReactRootTags';
import type { Container, Instance, TimeoutHandle, NoTimeout, ActivityInstance, SuspenseInstance, TransitionStatus, } from './ReactFiberConfig';
import type { Cache } from './ReactFiberCacheComponent';
import type { Transition } from 'react/src/ReactStartTransition';
import type { TracingMarkerInstance } from './ReactFiberTracingMarkerComponent';
import type { ConcurrentUpdate } from './ReactFiberConcurrentUpdates';
// The server's component stack node (react-server); the client never creates one.
type ComponentStackNode = {
    readonly parent: null | ComponentStackNode;
};
import type { ThenableState } from './ReactFiberThenable';
import type { ScheduledGesture } from './ReactFiberGestureScheduler';
// Unwind Circular: moved from ReactFiberHooks.old
export type HookType = 'useState' | 'useReducer' | 'useContext' | 'useRef' | 'useEffect' | 'useEffectEvent' | 'useInsertionEffect' | 'useLayoutEffect' | 'useCallback' | 'useMemo' | 'useImperativeHandle' | 'useDebugValue' | 'useDeferredValue' | 'useTransition' | 'useSyncExternalStore' | 'useId' | 'useCacheRefresh' | 'useOptimistic' | 'useFormState' | 'useActionState';
export type ContextDependency<T> = {
    context: ReactContext<T>;
    next: ContextDependency<unknown> | null;
    memoizedValue: T;
};
export type Dependencies = {
    lanes: Lanes;
    firstContext: ContextDependency<unknown> | null;
    _debugThenableState?: null | ThenableState; // DEV-only;
};
export type MemoCache = {
    data: Array<Array<any>>;
    index: number;
};
// A Fiber is work on a Component that needs to be done or was done. There can
// be more than one per component.
// The profiler-timer and dev-only optional fields (actualDuration, _debugInfo, ...) are left out: this build has
// neither, and each optional field was a slot in every FiberNode.
export type Fiber = {
    // These first fields are conceptually members of an Instance. This used to
    // be split into a separate type and intersected with the other Fiber fields,
    // but until Flow fixes its intersection bugs, we've merged them into a
    // single type.
    // An Instance is shared between all versions of a component. We can easily
    // break this out into a separate object to avoid copying so much to the
    // alternate versions of the tree. We put this on a single object for now to
    // minimize the number of objects created during the initial render.
    // Tag identifying the type of fiber.
    tag: WorkTag;
    // Unique identifier of this child.
    key: null | string;
    // The value of element.type which is used to preserve the identity during
    // reconciliation of this child.
    elementType: any;
    // The resolved function/class/ associated with this fiber.
    type: any;
    // The local state associated with this fiber.
    stateNode: any;
    // Conceptual aliases
    // parent : Instance -> return The parent happens to be the same as the
    // return fiber since we've merged the fiber and instance.
    // Remaining fields belong to Fiber
    // The Fiber to return to after finishing processing this one.
    // This is effectively the parent, but there can be multiple parents (two)
    // so this is only the parent of the thing we're currently processing.
    // It is conceptually the same as the return address of a stack frame.
    return: Fiber | null;
    // Singly Linked List Tree Structure.
    child: Fiber | null;
    sibling: Fiber | null;
    index: number;
    // The ref last used to attach this node.
    // I'll avoid adding an owner field for prod and model that as functions.
    ref: null | ((handle: unknown) => void) & {
        _stringRef: string | null | undefined;
    } | RefObject;
    // What the ref callback returned: a cleanup function, or nothing.
    refCleanup: null | void | (() => void);
    // Input is the data coming into process this fiber. Arguments. Props.
    pendingProps: any; // This type will be more specific once we overload the tag.;
    memoizedProps: any; // The props used to create the output.;
    // A queue of state updates and callbacks.
    updateQueue: unknown;
    // The state used to create the output
    memoizedState: any;
    // Dependencies (contexts, events) for this fiber, if it has any
    dependencies: Dependencies | null;
    // Bitfield that describes properties about the fiber and its subtree. E.g.
    // the ConcurrentMode flag indicates whether the subtree should be async-by-
    // default. When a fiber is created, it inherits the mode of its
    // parent. Additional flags can be set at creation time, but after that the
    // value should remain unchanged throughout the fiber's lifetime, particularly
    // before its child fibers are created.
    mode: TypeOfMode;
    // Effect
    flags: Flags;
    subtreeFlags: Flags;
    deletions: Array<Fiber> | null;
    lanes: Lanes;
    childLanes: Lanes;
    // This is a pooled version of a Fiber. Every fiber that gets updated will
    // eventually have a pair. There are cases when we can clean up pairs to save
    // memory if we need to.
    alternate: Fiber | null;
    // Time spent rendering this Fiber and its descendants for the current update.
    // This tells us how well the tree makes use of sCU for memoization.
    // It is reset to 0 each time we render and only updated when we don't bailout.
    // This field is only set when the enableProfilerTimer flag is enabled.
    // If the Fiber is currently active in the "render" phase,
    // This marks the time at which the work began.
    // This field is only set when the enableProfilerTimer flag is enabled.
    // Duration of the most recent render time for this Fiber.
    // This value is not updated when we bailout for memoization purposes.
    // This field is only set when the enableProfilerTimer flag is enabled.
    // Sum of base times for all descendants of this Fiber.
    // This value bubbles up during the "complete" phase.
    // This field is only set when the enableProfilerTimer flag is enabled.
    // Conceptual aliases
    // workInProgress : Fiber ->  alternate The alternate used for reuse happens
    // to be the same as work in progress.
    // __DEV__ only
    // Used to verify that the order of hooks does not change between renders.
};
export type SuspenseHydrationCallbacks = {
    readonly onHydrated?: (hydrationBoundary: SuspenseInstance | ActivityInstance) => void;
    readonly onDeleted?: (hydrationBoundary: SuspenseInstance | ActivityInstance) => void;
};
export type TransitionTracingCallbacks = {
    onTransitionStart?: (transitionName: string, startTime: number) => void;
    onTransitionProgress?: (transitionName: string, startTime: number, currentTime: number, pending: Array<{
        name: null | string;
    }>) => void;
    onTransitionIncomplete?: (transitionName: string, startTime: number, deletions: Array<{
        type: string;
        name?: string | null;
        endTime: number;
    }>) => void;
    onTransitionComplete?: (transitionName: string, startTime: number, endTime: number) => void;
    onMarkerProgress?: (transitionName: string, marker: string, startTime: number, currentTime: number, pending: Array<{
        name: null | string;
    }>) => void;
    onMarkerIncomplete?: (transitionName: string, marker: string, startTime: number, deletions: Array<{
        type: string;
        name?: string | null;
        endTime: number;
    }>) => void;
    onMarkerComplete?: (transitionName: string, marker: string, startTime: number, endTime: number) => void;
};
// Exported FiberRoot type includes all properties,
// To avoid requiring potentially error-prone :any casts throughout the project.
// The types are defined separately within this file to ensure they stay in sync.
// One record (React's Flow type intersects five property groups; an intersection has no runtime shape of its own).
export type FiberRoot = {
    // BaseFiberRootProperties
    // The type of root (legacy, batched, concurrent, etc.)
    tag: RootTag;
    // Any additional information from the host associated with this root.
    containerInfo: Container;
    // Used only by persistent updates.
    pendingChildren: any;
    // The currently active root fiber. This is the mutable root of the tree.
    current: Fiber;
    pingCache: WeakMap<Wakeable, Set<unknown>> | null;
    // Timeout handle returned by setTimeout. Used to cancel a pending timeout, if
    // it's superseded by a new one.
    timeoutHandle: TimeoutHandle | NoTimeout;
    // When a root has a pending commit scheduled, calling this function will
    // cancel it.
    // TODO: Can this be consolidated with timeoutHandle?
    cancelPendingCommit: null | (() => void);
    // Top context object, used by renderSubtreeIntoContainer
    context: Record<any, any> | null;
    pendingContext: Record<any, any> | null;
    // Used to create a linked list that represent all the roots that have
    // pending work scheduled on them.
    next: FiberRoot | null;
    // Node returned by Scheduler.scheduleCallback. Represents the next rendering
    // task that the root will work on.
    callbackNode: Task | null;
    callbackPriority: Lane;
    expirationTimes: LaneMap<number>;
    hiddenUpdates: LaneMap<Array<ConcurrentUpdate> | null>;
    pendingLanes: Lanes;
    suspendedLanes: Lanes;
    pingedLanes: Lanes;
    warmLanes: Lanes;
    expiredLanes: Lanes;
    indicatorLanes?: Lanes; // enableDefaultTransitionIndicator only;
    errorRecoveryDisabledLanes: Lanes;
    shellSuspendCounter: number;
    entangledLanes: Lanes;
    entanglements: LaneMap<Lanes>;
    pooledCache: Cache | null;
    pooledCacheLanes: Lanes;
    // TODO: In Fizz, id generation is specific to each server config. Maybe we
    // should do this in Fiber, too? Deferring this decision for now because
    // there's no other place to store the prefix except for an internal field on
    // the public createRoot object, which the fiber tree does not currently have
    // a reference to.
    identifierPrefix: string;
    onUncaughtError: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    onCaughtError: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
        readonly errorBoundary?: object | null | undefined; // the boundary class instance
    }) => void;
    onRecoverableError: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    // enableDefaultTransitionIndicator only
    onDefaultTransitionIndicator?: () => undefined | (() => void);
    pendingIndicator?: null | (() => void);
    formState: ReactFormState<any, any> | null;
    // enableViewTransition only
    transitionTypes?: null | TransitionTypes; // TODO: Make this a LaneMap.;
    // enableGestureTransition only
    pendingGestures?: null | ScheduledGesture;
    stoppingGestures?: null | ScheduledGesture;
    gestureClone?: null | Instance;
    // SuspenseCallbackOnlyFiberRootProperties
    hydrationCallbacks?: null | SuspenseHydrationCallbacks;
    // UpdaterTrackingOnlyFiberRootProperties
    memoizedUpdaters?: Set<Fiber>;
    pendingUpdatersLaneMap?: LaneMap<Set<Fiber>>;
    // TransitionTracingOnlyFiberRootProperties
    transitionCallbacks?: null | TransitionTracingCallbacks;
    transitionLanes?: LaneMap<Set<Transition> | null>;
    // Transitions on the root can be represented as a bunch of tracing markers.
    // Each entangled group of transitions can be treated as a tracing marker.
    // It will have a set of pending suspense boundaries. These transitions
    // are considered complete when the pending suspense boundaries set is
    // empty. We can represent this as a Map of transitions to suspense
    // boundary sets
    incompleteTransitions: Map<Transition, TracingMarkerInstance>;
    // ProfilerCommitHooksOnlyFiberRootProperties
    effectDuration?: number;
    passiveEffectDuration?: number;
};
// The hooks dispatcher, erased: user value types cross it as `unknown`, so the reconciler keeps one copy of its
// hook machinery for every state type (React's Flow type is generic per hook; the public hooks in react/src/ReactHooks
// keep those signatures and adapt at this boundary).
export type HookReducer = (state: unknown, action: unknown) => unknown;
export type HookDispatch = (action: unknown) => void;
// A ref object, a ref callback, or null/undefined: unknown here (a record and a function share no representation);
// the reconciler narrows it with typeof.
export type HookRef = unknown;
export type Dispatcher = {
    use: (usable: Usable<unknown>) => unknown;
    readContext(context: ReactContext<unknown>): unknown;
    useState(initialState: unknown): [
        unknown,
        HookDispatch
    ];
    useReducer(reducer: HookReducer, initialArg: unknown, init?: (initialArg: unknown) => unknown): [
        unknown,
        HookDispatch
    ];
    useContext(context: ReactContext<unknown>): unknown;
    useRef(initialValue: unknown): {
        current: unknown;
    };
    useEffect(create: () => (() => void) | void, deps: Array<unknown> | undefined | null): void;
    // TODO: Non-nullable once `enableUseEffectEventHook` is on everywhere.
    useEffectEvent?: (callback: (...args: Array<unknown>) => unknown) => (...args: Array<unknown>) => unknown;
    useInsertionEffect(create: () => (() => void) | void, deps: Array<unknown> | undefined | null): void;
    useLayoutEffect(create: () => (() => void) | void, deps: Array<unknown> | undefined | null): void;
    useCallback(callback: unknown, deps: Array<unknown> | undefined | null): unknown;
    useMemo(nextCreate: () => unknown, deps: Array<unknown> | undefined | null): unknown;
    useImperativeHandle(ref: HookRef, create: () => unknown, deps: Array<unknown> | undefined | null): void;
    useDebugValue(value: unknown, formatterFn?: ((value: unknown) => unknown) | null | undefined): void;
    useDeferredValue(value: unknown, initialValue?: unknown): unknown;
    useTransition(): [
        boolean,
        (callback: () => void, options?: StartTransitionOptions) => void
    ];
    useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => unknown, getServerSnapshot?: () => unknown): unknown;
    useId(): string;
    useCacheRefresh: () => (fetch?: (() => unknown) | null, seed?: unknown) => void;
    useMemoCache: (size: number) => Array<unknown>;
    useHostTransitionStatus: () => TransitionStatus;
    useOptimistic: (passthrough: unknown, reducer?: HookReducer | null) => [
        unknown,
        HookDispatch
    ];
    useFormState: (action: HookReducer, initialState: unknown, permalink?: string) => [
        unknown,
        HookDispatch,
        boolean
    ];
    useActionState: (action: HookReducer, initialState: unknown, permalink?: string) => [
        unknown,
        HookDispatch,
        boolean
    ];
};
// The signal of the reconciler's AbortController shim (used where the platform has no AbortController).
export type ShimAbortSignal = {
    aborted: boolean;
    addEventListener: (type: 'abort', listener: () => void) => void;
};
// A cache's signal: the platform's AbortSignal, or the shim's.
export type CacheAbortSignal = AbortSignal | ShimAbortSignal;
export type AsyncDispatcher = {
    getCacheForType: <T>(resourceType: () => T) => T;
    cacheSignal: () => null | CacheAbortSignal;
};
