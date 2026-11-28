/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
import type { Transition } from 'react/src/ReactStartTransition';
import is from 'shared/objectIs';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import { REACT_CONTEXT_TYPE,REACT_MEMO_CACHE_SENTINEL } from 'shared/ReactSymbols';
import type { Awaited,ReactContext,RejectedThenable,StartTransitionOptions,Thenable,Usable } from 'shared/ReactTypes';
import { ContinuousEventPriority,higherEventPriority } from './ReactEventPriorities';
import { chainThenableValue,peekEntangledActionLane,peekEntangledActionThenable } from './ReactFiberAsyncAction';
import { checkIfWorkInProgressReceivedUpdate,markWorkInProgressReceivedUpdate } from './ReactFiberBeginWork';
import { createCache } from './ReactFiberCacheComponent';
import { createUpdate as createLegacyQueueUpdate,enqueueUpdate as enqueueLegacyQueueUpdate,entangleTransitions as entangleLegacyQueueTransitions } from './ReactFiberClassUpdateQueue';
import { enqueueConcurrentHookUpdate,enqueueConcurrentHookUpdateAndEagerlyBailout,enqueueConcurrentRenderForLane } from './ReactFiberConcurrentUpdates';
import type { TransitionStatus } from './ReactFiberConfig';
import { getCurrentUpdatePriority,HostTransitionContext,NotPendingTransition as NoPendingHostTransition,setCurrentUpdatePriority } from './ReactFiberConfig';
import { setIsStrictModeForDevtools } from './ReactFiberDevToolsHook';
import type { Flags } from './ReactFiberFlags';
import { FormReset,LayoutStatic as LayoutStaticEffect,Passive as PassiveEffect,PassiveStatic as PassiveStaticEffect,StoreConsistency,Update as UpdateEffect } from './ReactFiberFlags';
import type { ScheduledGesture } from './ReactFiberGestureScheduler';
import { isCurrentTreeHidden } from './ReactFiberHiddenContext';
import { getIsHydrating,tryToClaimNextHydratableFormMarkerInstance } from './ReactFiberHydrationContext';
import type { Lane,Lanes } from './ReactFiberLane';
import { DeferredLane,includesBlockingLane,includesOnlyNonUrgentLanes,includesSomeLane,intersectLanes,isSubsetOfLanes,isTransitionLane,markRootEntangled,mergeLanes,NoLane,NoLanes,OffscreenLane,removeLanes,SyncLane,UpdateLanes } from './ReactFiberLane';
import { checkIfContextChanged,readContext } from './ReactFiberNewContext';
import { requestTransitionLane } from './ReactFiberRootScheduler';
import type { ThenableState } from './ReactFiberThenable';
import { createThenableState,SuspenseActionException,SuspenseException,trackUsedThenable } from './ReactFiberThenable';
import { requestCurrentTransition } from './ReactFiberTransition';
import { getTreeId } from './ReactFiberTreeContext';
import { getWorkInProgressRoot,getWorkInProgressRootRenderLanes,isInvalidExecutionContextForEventFunction,markSkippedUpdateLanes,requestDeferredLane,requestUpdateLane,scheduleUpdateOnFiber } from './ReactFiberWorkLoop';
import type { HookFlags } from './ReactHookEffectTags';
import { HasEffect as HookHasEffect,Insertion as HookInsertion,Layout as HookLayout,Passive as HookPassive } from './ReactHookEffectTags';
import type { Dispatcher,Fiber,FiberRoot,MemoCache } from './ReactInternalTypes';
import { startHostActionTimer,startUpdateTimerByLane } from './ReactProfilerTimer';
import { CacheComponent,HostComponent,HostRoot } from './ReactWorkTags';
export type Update<S, A> = {
    lane: Lane;
    revertLane: Lane;
    action: unknown;
    hasEagerState: boolean;
    eagerState: unknown | null;
    // Circular: set right after the update is created.
    next: Update<unknown, unknown> | null;
    gesture: null | ScheduledGesture; // enableGestureTransition;
};
export type UpdateQueue<S, A> = {
    pending: Update<unknown, unknown> | null;
    lanes: Lanes;
    dispatch: ((arg1: unknown) => unknown) | null;
    lastRenderedReducer: ((arg1: unknown, arg2: unknown) => unknown) | null;
    lastRenderedState: unknown | null;
};
;
export type Hook = {
    memoizedState: any;
    baseState: any;
    baseQueue: Update<any, any> | null;
    queue: any;
    next: Hook | null;
};
// The effect "instance" is a shared object that remains the same for the entire
// lifetime of an effect. In Rust terms, a RefCell. We use it to store the
// "destroy" function that is returned from an effect, because that is stateful.
// The field is `undefined` if the effect is unmounted, or if the effect ran
// but is not stateful. We don't explicitly track whether the effect is mounted
// or unmounted because that can be inferred by the hiddenness of the fiber in
// the tree, i.e. whether there is a hidden Offscreen fiber above it.
// It's unfortunate that this is stored on a separate object, because it adds
// more memory per effect instance, but it's conceptually sound. I think there's
// likely a better data structure we could use for effects; perhaps just one
// array of effect instances per fiber. But I think this is OK for now despite
// the additional memory and we can follow up with performance
// optimizations later.
type EffectInstance = {
    destroy: void | (() => void);
};
export type Effect = {
    tag: HookFlags;
    inst: EffectInstance;
    create: () => (() => void) | void;
    deps: Array<unknown> | null;
    // Circular: set right after the effect is created.
    next: Effect | null;
};
type StoreInstance<T> = {
    value: unknown;
    getSnapshot: () => unknown;
};
type StoreConsistencyCheck<T> = {
    value: unknown;
    getSnapshot: () => unknown;
};
// Any function: `never[]` parameters accept every signature without `any`.
// A useEffectEvent callback, erased like the rest of the dispatcher (react/src/ReactHooks adapts the user's function).
type EventFunction = (...args: Array<unknown>) => unknown;
type EventFunctionPayload<F extends EventFunction> = {
    ref: {
        eventFn: F;
        impl: F;
    };
    nextImpl: F;
};
export type FunctionComponentUpdateQueue = {
    lastEffect: Effect | null;
    events: Array<EventFunctionPayload<EventFunction>> | null;
    stores: Array<StoreConsistencyCheck<any>> | null;
    memoCache: MemoCache | null;
};
type BasicStateAction<S> = ((arg1: unknown) => unknown) | unknown;
type Dispatch<A> = (arg1: unknown) => void;
// These are set right before calling the component.
let renderLanes: Lanes = NoLanes;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber | null = null;
// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;
// Whether an update was scheduled at any point during the render phase. This
// does not get reset if we do another render pass; only when we're completely
// finished evaluating this component. This is an optimization so we know
// whether we need to clear render phase updates after a throw.
let didScheduleRenderPhaseUpdate: boolean = false;
// Where an update was scheduled only during the current render pass. This
// gets reset after each attempt.
// TODO: Maybe there's some way to consolidate this with
// `didScheduleRenderPhaseUpdate`. Or with `numberOfReRenders`.
let didScheduleRenderPhaseUpdateDuringThisPass: boolean = false;
let shouldDoubleInvokeUserFnsInHooksDEV: boolean = false;
// Counts the number of useId hooks in this component.
let localIdCounter: number = 0;
// Counts number of `use`-d thenables
let thenableIndexCounter: number = 0;
let thenableState: ThenableState | null = null;
// Used for ids that are generated completely client-side (i.e. not during
// hydration). This counter is global, so client ids are not stable across
// render attempts.
let globalClientIdCounter: number = 0;
const RE_RENDER_LIMIT = 25;
function throwInvalidHookError(): never {
    throw new Error('Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.');
}
function areHookInputsEqual(nextDeps: Array<unknown>, prevDeps: Array<unknown> | null): boolean {
    ;
    if (prevDeps === null) {
        ;
        return false;
    }
    ;
    for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
        if (is(nextDeps[i], prevDeps[i])) {
            continue;
        }
        return false;
    }
    return true;
}
export function renderWithHooks(current: Fiber | null, workInProgress: Fiber, Component: (p: unknown, arg: unknown) => any, props: unknown, secondArg: unknown, nextRenderLanes: Lanes): any {
    renderLanes = nextRenderLanes;
    currentlyRenderingFiber = workInProgress;
    ;
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;
    workInProgress.lanes = NoLanes;
    {
        ReactSharedInternals.H =
            current === null || current.memoizedState === null
                ? HooksDispatcherOnMount
                : HooksDispatcherOnUpdate;
    }
    // In Strict Mode, during development, user functions are double invoked to
    // help detect side effects. The logic for how this is implemented for in
    // hook components is a bit complex so let's break it down.
    //
    // We will invoke the entire component function twice. However, during the
    // second invocation of the component, the hook state from the first
    // invocation will be reused. That means things like `useMemo` functions won't
    // run again, because the deps will match and the memoized result will
    // be reused.
    //
    // We want memoized functions to run twice, too, so account for this, user
    // functions are double invoked during the *first* invocation of the component
    // function, and are *not* double invoked during the second incovation:
    //
    // - First execution of component function: user functions are double invoked
    // - Second execution of component function (in Strict Mode, during
    //   development): user functions are not double invoked.
    //
    // This is intentional for a few reasons; most importantly, it's because of
    // how `use` works when something suspends: it reuses the promise that was
    // passed during the first attempt. This is itself a form of memoization.
    // We need to be able to memoize the reactive inputs to the `use` call using
    // a hook (i.e. `useMemo`), which means, the reactive inputs to `use` must
    // come from the same component invocation as the output.
    //
    // There are plenty of tests to ensure this behavior is correct.
    const shouldDoubleRenderDEV = false;
    shouldDoubleInvokeUserFnsInHooksDEV = shouldDoubleRenderDEV;
    let children = Component(props, secondArg);
    shouldDoubleInvokeUserFnsInHooksDEV = false;
    // Check if there was a render phase update
    if (didScheduleRenderPhaseUpdateDuringThisPass) {
        // Keep rendering until the component stabilizes (there are no more render
        // phase updates).
        children = renderWithHooksAgain(workInProgress, Component, props, secondArg);
    }
    if (shouldDoubleRenderDEV) {
        // In development, components are invoked twice to help detect side effects.
        setIsStrictModeForDevtools(true);
        try {
            children = renderWithHooksAgain(workInProgress, Component, props, secondArg);
        }
        finally {
            setIsStrictModeForDevtools(false);
        }
    }
    finishRenderingHooks(current, workInProgress, Component);
    return children;
}
function finishRenderingHooks(current: Fiber | null, workInProgress: Fiber, Component: (p: unknown, arg: unknown) => any): void {
    ;
    // We can assume the previous dispatcher is always this one, since we set it
    // at the beginning of the render phase and there's no re-entrance.
    ReactSharedInternals.H = ContextOnlyDispatcher;
    // This check uses currentHook so that it works the same in DEV and prod bundles.
    // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
    const didRenderTooFewHooks = currentHook !== null && currentHook.next !== null;
    renderLanes = NoLanes;
    currentlyRenderingFiber = null;
    currentHook = null;
    workInProgressHook = null;
    ;
    didScheduleRenderPhaseUpdate = false;
    // This is reset by checkDidRenderIdHook
    // localIdCounter = 0;
    thenableIndexCounter = 0;
    thenableState = null;
    if (didRenderTooFewHooks) {
        throw new Error('Rendered fewer hooks than expected. This may be caused by an accidental ' +
            'early return statement.');
    }
    if (current !== null) {
        if (!checkIfWorkInProgressReceivedUpdate()) {
            // If there were no changes to props or state, we need to check if there
            // was a context change. We didn't already do this because there's no
            // 1:1 correspondence between dependencies and hooks. Although, because
            // there almost always is in the common case (`readContext` is an
            // internal API), we could compare in there. OTOH, we only hit this case
            // if everything else bails out, so on the whole it might be better to
            // keep the comparison out of the common path.
            const currentDependencies = current.dependencies;
            if (currentDependencies !== null &&
                checkIfContextChanged(currentDependencies)) {
                markWorkInProgressReceivedUpdate();
            }
        }
    }
    ;
}
export function replaySuspendedComponentWithHooks(current: Fiber | null, workInProgress: Fiber, Component: (p: unknown, arg: unknown) => any, props: unknown, secondArg: unknown): any {
    ;
    // renderWithHooks only resets the updateQueue but does not clear it, since
    // it needs to work for both this case (suspense replay) as well as for double
    // renders in dev and setState-in-render. However, for the suspense replay case
    // we need to reset the updateQueue to correctly handle unmount effects, so we
    // clear the queue here
    workInProgress.updateQueue = null;
    const children = renderWithHooksAgain(workInProgress, Component, props, secondArg);
    finishRenderingHooks(current, workInProgress, Component);
    return children;
}
function renderWithHooksAgain(workInProgress: Fiber, Component: (p: unknown, arg: unknown) => any, props: unknown, secondArg: unknown): any {
    // This is used to perform another render pass. It's used when setState is
    // called during render, and for double invoking components in Strict Mode
    // during development.
    //
    // The state from the previous pass is reused whenever possible. So, state
    // updates that were already processed are not processed again, and memoized
    // functions (`useMemo`) are not invoked again.
    //
    // Keep rendering in a loop for as long as render phase updates continue to
    // be scheduled. Use a counter to prevent infinite loops.
    currentlyRenderingFiber = workInProgress;
    let numberOfReRenders: number = 0;
    let children;
    do {
        if (didScheduleRenderPhaseUpdateDuringThisPass) {
            // It's possible that a use() value depended on a state that was updated in
            // this rerender, so we need to watch for different thenables this time.
            thenableState = null;
        }
        thenableIndexCounter = 0;
        didScheduleRenderPhaseUpdateDuringThisPass = false;
        if (numberOfReRenders >= RE_RENDER_LIMIT) {
            throw new Error('Too many re-renders. React limits the number of renders to prevent ' +
                'an infinite loop.');
        }
        numberOfReRenders += 1;
        ;
        // Start over from the beginning of the list
        currentHook = null;
        workInProgressHook = null;
        if (workInProgress.updateQueue != null) {
            resetFunctionComponentUpdateQueue((workInProgress.updateQueue as FunctionComponentUpdateQueue));
        }
        ;
        ReactSharedInternals.H =
            HooksDispatcherOnRerender;
        children =
            Component(props, secondArg);
    } while (didScheduleRenderPhaseUpdateDuringThisPass);
    return children;
}
export function renderTransitionAwareHostComponentWithHooks(current: Fiber | null, workInProgress: Fiber, lanes: Lanes): TransitionStatus {
    return renderWithHooks(current, workInProgress, TransitionAwareHostComponent, null, null, lanes);
}
export function TransitionAwareHostComponent(): TransitionStatus {
    // React reads the current dispatcher and calls useState with no initial state (undefined).
    const dispatcher: Dispatcher = ReactSharedInternals.H!;
    const [maybeThenable] = dispatcher.useState(undefined);
    let nextState: TransitionStatus;
    if (typeof readProperty(maybeThenable as object, 'then') === 'function') {
        const thenable = maybeThenable as Thenable<TransitionStatus>;
        nextState = useThenable(thenable) as TransitionStatus;
    }
    else {
        const status = maybeThenable as TransitionStatus;
        nextState = status;
    }
    // The "reset state" is an object. If it changes, that means something
    // requested that we reset the form.
    const [nextResetState] = dispatcher.useState(undefined);
    const prevResetState = currentHook !== null ? currentHook.memoizedState : null;
    if (prevResetState !== nextResetState) {
        // Schedule a form reset
        currentlyRenderingFiber!.flags |= FormReset;
    }
    return nextState;
}
export function checkDidRenderIdHook(): boolean {
    // This should be called immediately after every renderWithHooks call.
    // Conceptually, it's part of the return value of renderWithHooks; it's only a
    // separate function to avoid using an array tuple.
    const didRenderIdHook = localIdCounter !== 0;
    localIdCounter = 0;
    return didRenderIdHook;
}
export function bailoutHooks(current: Fiber, workInProgress: Fiber, lanes: Lanes): void {
    workInProgress.updateQueue = current.updateQueue;
    {
        workInProgress.flags &= ~(PassiveEffect | UpdateEffect);
    }
    current.lanes = removeLanes(current.lanes, lanes);
}
export function resetHooksAfterThrow(): void {
    // This is called immediaetly after a throw. It shouldn't reset the entire
    // module state, because the work loop might decide to replay the component
    // again without rewinding.
    //
    // It should only reset things like the current dispatcher, to prevent hooks
    // from being called outside of a component.
    currentlyRenderingFiber = null;
    // We can assume the previous dispatcher is always this one, since we set it
    // at the beginning of the render phase and there's no re-entrance.
    ReactSharedInternals.H = ContextOnlyDispatcher;
}
export function resetHooksOnUnwind(workInProgress: Fiber): void {
    if (didScheduleRenderPhaseUpdate) {
        // There were render phase updates. These are only valid for this render
        // phase, which we are now aborting. Remove the updates from the queues so
        // they do not persist to the next render. Do not remove updates from hooks
        // that weren't processed.
        //
        // Only reset the updates from the queue if it has a clone. If it does
        // not have a clone, that means it wasn't processed, and the updates were
        // scheduled before we entered the render phase.
        let hook: Hook | null = workInProgress.memoizedState;
        while (hook !== null) {
            const queue = hook.queue;
            if (queue !== null) {
                queue.pending = null;
            }
            hook = hook.next;
        }
        didScheduleRenderPhaseUpdate = false;
    }
    renderLanes = NoLanes;
    currentlyRenderingFiber = null;
    currentHook = null;
    workInProgressHook = null;
    ;
    didScheduleRenderPhaseUpdateDuringThisPass = false;
    localIdCounter = 0;
    thenableIndexCounter = 0;
    thenableState = null;
}
function mountWorkInProgressHook(): Hook {
    const hook: Hook = {
        memoizedState: null,
        baseState: null,
        baseQueue: null,
        queue: null,
        next: null,
    };
    if (workInProgressHook === null) {
        // This is the first hook in the list
        currentlyRenderingFiber!.memoizedState = workInProgressHook = hook;
    }
    else {
        // Append to the end of the list
        workInProgressHook = workInProgressHook.next = hook;
    }
    return workInProgressHook;
}
function updateWorkInProgressHook(): Hook {
    // This function is used both for updates and for re-renders triggered by a
    // render phase update. It assumes there is either a current hook we can
    // clone, or a work-in-progress hook from a previous render pass that we can
    // use as a base.
    let nextCurrentHook: null | Hook;
    if (currentHook === null) {
        const current = currentlyRenderingFiber!.alternate;
        if (current !== null) {
            nextCurrentHook = current.memoizedState;
        }
        else {
            nextCurrentHook = null;
        }
    }
    else {
        nextCurrentHook = currentHook.next;
    }
    let nextWorkInProgressHook: null | Hook;
    if (workInProgressHook === null) {
        nextWorkInProgressHook = currentlyRenderingFiber!.memoizedState;
    }
    else {
        nextWorkInProgressHook = workInProgressHook.next;
    }
    if (nextWorkInProgressHook !== null) {
        // There's already a work-in-progress. Reuse it.
        workInProgressHook = nextWorkInProgressHook;
        nextWorkInProgressHook = workInProgressHook.next;
        currentHook = nextCurrentHook;
    }
    else {
        // Clone from the current hook.
        if (nextCurrentHook === null) {
            const currentFiber = currentlyRenderingFiber!.alternate;
            if (currentFiber === null) {
                // This is the initial render. This branch is reached when the component
                // suspends, resumes, then renders an additional hook.
                // Should never be reached because we should switch to the mount dispatcher first.
                throw new Error('Update hook called on initial render. This is likely a bug in React. Please file an issue.');
            }
            else {
                // This is an update. We should always have a current hook.
                throw new Error('Rendered more hooks than during the previous render.');
            }
        }
        currentHook = nextCurrentHook;
        const newHook: Hook = {
            memoizedState: currentHook.memoizedState,
            baseState: currentHook.baseState,
            baseQueue: currentHook.baseQueue,
            queue: currentHook.queue,
            next: null,
        };
        if (workInProgressHook === null) {
            // This is the first hook in the list.
            currentlyRenderingFiber!.memoizedState = workInProgressHook = newHook;
        }
        else {
            // Append to the end of the list.
            workInProgressHook = workInProgressHook.next = newHook;
        }
    }
    return workInProgressHook;
}
function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
    return {
        lastEffect: null,
        events: null,
        stores: null,
        memoCache: null,
    };
}
function resetFunctionComponentUpdateQueue(updateQueue: FunctionComponentUpdateQueue): void {
    updateQueue.lastEffect = null;
    updateQueue.events = null;
    updateQueue.stores = null;
    if (updateQueue.memoCache != null) {
        // NOTE: this function intentionally does not reset memoCache data. We reuse updateQueue for the memo
        // cache to avoid increasing the size of fibers that don't need a cache, but we don't want to reset
        // the cache when other properties are reset.
        updateQueue.memoCache.index = 0;
    }
}
function useThenable(thenable: Thenable<unknown>): unknown {
    // Track the position of the thenable within this fiber.
    const index = thenableIndexCounter;
    thenableIndexCounter += 1;
    if (thenableState === null) {
        thenableState = createThenableState();
    }
    const result = trackUsedThenable(thenableState, thenable, index);
    // When something suspends with `use`, we replay the component with the
    // "re-render" dispatcher instead of the "mount" or "update" dispatcher.
    //
    // But if there are additional hooks that occur after the `use` invocation
    // that suspended, they wouldn't have been processed during the previous
    // attempt. So after we invoke `use` again, we may need to switch from the
    // "re-render" dispatcher back to the "mount" or "update" dispatcher. That's
    // what the following logic accounts for.
    //
    // TODO: Theoretically this logic only needs to go into the rerender
    // dispatcher. Could optimize, but probably not be worth it.
    // This is the same logic as in updateWorkInProgressHook.
    const workInProgressFiber = currentlyRenderingFiber;
    const nextWorkInProgressHook = workInProgressHook === null
        ? // We're at the beginning of the list, so read from the first hook from
            // the fiber.
            workInProgressFiber!.memoizedState
        : workInProgressHook.next;
    if (nextWorkInProgressHook !== null) {
        // There are still hooks remaining from the previous attempt.
    }
    else {
        // There are no remaining hooks from the previous attempt. We're no longer
        // in "re-render" mode. Switch to the normal mount or update dispatcher.
        //
        // This is the same as the logic in renderWithHooks, except we don't bother
        // to track the hook types debug information in this case (sufficient to
        // only do that when nothing suspends).
        const currentFiber = workInProgressFiber!.alternate;
        {
            ReactSharedInternals.H =
                currentFiber === null || currentFiber.memoizedState === null
                    ? HooksDispatcherOnMount
                    : HooksDispatcherOnUpdate;
        }
    }
    return result;
}
// String(usable), on the value as unknown (the message conversion of whatever was passed).
function describeUsable(usable: unknown): string {
    return String(usable);
}
function use(usable: Usable<unknown>): unknown {
    if (usable !== null && typeof usable === 'object') {
        if (typeof (usable as Thenable<unknown>).then === 'function') {
            // This is a thenable.
            const thenable: Thenable<unknown> = (usable as Thenable<unknown>);
            return useThenable(thenable);
        }
        else if ((usable as ReactContext<unknown>).$$typeof === REACT_CONTEXT_TYPE) {
            const context: ReactContext<unknown> = (usable as ReactContext<unknown>);
            return readContext(context);
        }
    }
    // eslint-disable-next-line react-internal/safe-string-coercion
    throw new Error('An unsupported type was passed to use(): ' + describeUsable(usable));
}
function useMemoCache(size: number): Array<unknown> {
    let memoCache = null;
    // Fast-path, load memo cache from wip fiber if already prepared
    let updateQueue: FunctionComponentUpdateQueue | null = (currentlyRenderingFiber!.updateQueue as FunctionComponentUpdateQueue | null);
    if (updateQueue !== null) {
        memoCache = updateQueue.memoCache;
    }
    // Otherwise clone from the current fiber
    if (memoCache == null) {
        const current: Fiber | null = currentlyRenderingFiber!.alternate;
        if (current !== null) {
            const currentUpdateQueue: FunctionComponentUpdateQueue | null = (current.updateQueue as FunctionComponentUpdateQueue | null);
            if (currentUpdateQueue !== null) {
                const currentMemoCache: MemoCache | null | undefined = currentUpdateQueue.memoCache;
                if (currentMemoCache != null) {
                    memoCache = {
                        // When enableNoCloningMemoCache is enabled, instead of treating the
                        // cache as copy-on-write, like we do with fibers, we share the same
                        // cache instance across all render attempts, even if the component
                        // is interrupted before it commits.
                        //
                        // If an update is interrupted, either because it suspended or
                        // because of another update, we can reuse the memoized computations
                        // from the previous attempt. We can do this because the React
                        // Compiler performs atomic writes to the memo cache, i.e. it will
                        // not record the inputs to a memoization without also recording its
                        // output.
                        //
                        // This gives us a form of "resuming" within components and hooks.
                        //
                        // This only works when updating a component that already mounted.
                        // It has no impact during initial render, because the memo cache is
                        // stored on the fiber, and since we have not implemented resuming
                        // for fibers, it's always a fresh memo cache, anyway.
                        //
                        // However, this alone is pretty useful — it happens whenever you
                        // update the UI with fresh data after a mutation/action, which is
                        // extremely common in a Suspense-driven (e.g. RSC or Relay) app.
                        data: // Clone the memo cache before each render (copy-on-write)
                        currentMemoCache.data.map((array) => array.slice()),
                        index: (0 as number),
                    };
                }
            }
        }
    }
    // Finally fall back to allocating a fresh instance of the cache
    if (memoCache == null) {
        memoCache = {
            data: [],
            index: (0 as number),
        };
    }
    if (updateQueue === null) {
        updateQueue = createFunctionComponentUpdateQueue();
        currentlyRenderingFiber!.updateQueue = updateQueue;
    }
    updateQueue.memoCache = memoCache;
    let data = memoCache.data[memoCache.index];
    if (data === undefined || (false)) {
        data = memoCache.data[memoCache.index] = new Array(size);
        for (let i = 0; i < size; i++) {
            data[i] = REACT_MEMO_CACHE_SENTINEL;
        }
    }
    else if (data.length !== size) {
        ;
    }
    memoCache.index++;
    return data;
}
// The action is a new state or a function of the old one; typed unknown so it is no union of a function and a value.
function basicStateReducer(state: unknown, action: unknown): unknown {
    return typeof action === 'function' ? (action as (state: unknown) => unknown)(state) : (action as unknown);
}
function mountReducer(reducer: (arg1: unknown, arg2: unknown) => unknown, initialArg: unknown | unknown, init?: (arg1: unknown) => unknown): [
    unknown,
    Dispatch<unknown>
] {
    const hook = mountWorkInProgressHook();
    let initialState: unknown;
    if (init !== undefined) {
        initialState = init(initialArg as unknown);
        if (shouldDoubleInvokeUserFnsInHooksDEV) {
            setIsStrictModeForDevtools(true);
            try {
                init(initialArg as unknown);
            }
            finally {
                setIsStrictModeForDevtools(false);
            }
        }
    }
    else {
        initialState = (initialArg as unknown);
    }
    hook.memoizedState = hook.baseState = initialState;
    const queue: UpdateQueue<unknown, unknown> = {
        pending: null,
        lanes: NoLanes,
        dispatch: null,
        lastRenderedReducer: reducer,
        lastRenderedState: initialState,
    };
    hook.queue = queue;
    const dispatch: Dispatch<unknown> = dispatchReducerAction.bind(null, currentlyRenderingFiber!, queue);
    queue.dispatch = dispatch;
    return [hook.memoizedState, dispatch];
}
function updateReducer(reducer: (arg1: unknown, arg2: unknown) => unknown, initialArg: unknown, init?: (arg1: unknown) => unknown): [
    unknown,
    Dispatch<unknown>
] {
    const hook = updateWorkInProgressHook();
    return updateReducerImpl(hook, (currentHook as Hook), reducer);
}
function updateReducerImpl(hook: Hook, current: Hook, reducer: (arg1: unknown, arg2: unknown) => unknown): [
    unknown,
    Dispatch<unknown>
] {
    const queue = hook.queue;
    if (queue === null) {
        throw new Error('Should have a queue. You are likely calling Hooks conditionally, ' +
            'which is not allowed. (https://react.dev/link/invalid-hook-call)');
    }
    queue.lastRenderedReducer = reducer;
    // The last rebase update that is NOT part of the base state.
    let baseQueue = hook.baseQueue;
    // The last pending update that hasn't been processed yet.
    const pendingQueue = queue.pending;
    if (pendingQueue !== null) {
        // We have new updates that haven't been processed yet.
        // We'll add them to the base queue.
        if (baseQueue !== null) {
            // Merge the pending queue and the base queue.
            const baseFirst = baseQueue.next;
            const pendingFirst = pendingQueue.next;
            baseQueue.next = pendingFirst;
            pendingQueue.next = baseFirst;
        }
        ;
        current.baseQueue = baseQueue = pendingQueue;
        queue.pending = null;
    }
    const baseState = hook.baseState;
    if (baseQueue === null) {
        // If there are no pending updates, then the memoized state should be the
        // same as the base state. Currently these only diverge in the case of
        // useOptimistic, because useOptimistic accepts a new baseState on
        // every render.
        hook.memoizedState = baseState;
        // We don't need to call markWorkInProgressReceivedUpdate because
        // baseState is derived from other reactive values.
    }
    else {
        // We have a queue to process.
        const first = baseQueue.next;
        let newState = baseState;
        let newBaseState: unknown | null = null;
        // Widened declarations: the loop assigns them (the checker would narrow the initial null).
        let newBaseQueueFirst = null as Update<unknown, unknown> | null;
        let newBaseQueueLast = null as Update<unknown, unknown> | null;
        let update = first;
        let didReadFromEntangledAsyncAction = false;
        do {
            // An extra OffscreenLane bit is added to updates that were made to
            // a hidden tree, so that we can distinguish them from updates that were
            // already there when the tree was hidden.
            const updateLane = removeLanes(update!.lane, OffscreenLane);
            const isHiddenUpdate = updateLane !== update!.lane;
            // Check if this update was made while the tree was hidden. If so, then
            // it's not a "base" update and we should disregard the extra base lanes
            // that were added to renderLanes when we entered the Offscreen tree.
            let shouldSkipUpdate = isHiddenUpdate
                ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
                : !isSubsetOfLanes(renderLanes, updateLane);
            ;
            if (shouldSkipUpdate) {
                // Priority is insufficient. Skip this update. If this is the first
                // skipped update, the previous update/state is the new base
                // update/state.
                const clone: Update<unknown, unknown> = {
                    lane: updateLane,
                    revertLane: update!.revertLane,
                    gesture: update!.gesture,
                    action: update!.action,
                    hasEagerState: update!.hasEagerState,
                    eagerState: update!.eagerState,
                    next: null,
                };
                if (newBaseQueueLast === null) {
                    newBaseQueueFirst = newBaseQueueLast = clone;
                    newBaseState = newState;
                }
                else {
                    newBaseQueueLast = newBaseQueueLast.next = clone;
                }
                // Update the remaining priority in the queue.
                // TODO: Don't need to accumulate this. Instead, we can remove
                // renderLanes from the original lanes.
                currentlyRenderingFiber!.lanes = mergeLanes(currentlyRenderingFiber!.lanes, updateLane);
                markSkippedUpdateLanes(updateLane);
            }
            else {
                // This update does have sufficient priority.
                // Check if this is an optimistic update.
                const revertLane = update!.revertLane;
                if (revertLane === NoLane) {
                    // This is not an optimistic update, and we're going to apply it now.
                    // But, if there were earlier updates that were skipped, we need to
                    // leave this update in the queue so it can be rebased later.
                    if (newBaseQueueLast !== null) {
                        const clone: Update<unknown, unknown> = {
                            // This update is going to be committed so we never want uncommit
                            // it. Using NoLane works because 0 is a subset of all bitmasks, so
                            // this will never be skipped by the check above.
                            lane: NoLane,
                            revertLane: NoLane,
                            gesture: null,
                            action: update!.action,
                            hasEagerState: update!.hasEagerState,
                            eagerState: update!.eagerState,
                            next: null,
                        };
                        newBaseQueueLast = newBaseQueueLast.next = clone;
                    }
                    // Check if this update is part of a pending async action. If so,
                    // we'll need to suspend until the action has finished, so that it's
                    // batched together with future updates in the same action.
                    if (updateLane === peekEntangledActionLane()) {
                        didReadFromEntangledAsyncAction = true;
                    }
                }
                else {
                    // This is an optimistic update. If the "revert" priority is
                    // sufficient, don't apply the update. Otherwise, apply the update,
                    // but leave it in the queue so it can be either reverted or
                    // rebased in a subsequent render.
                    if (isSubsetOfLanes(renderLanes, revertLane)) {
                        // The transition that this optimistic update is associated with
                        // has finished. Pretend the update doesn't exist by skipping
                        // over it.
                        update = update!.next;
                        // Check if this update is part of a pending async action. If so,
                        // we'll need to suspend until the action has finished, so that it's
                        // batched together with future updates in the same action.
                        if (revertLane === peekEntangledActionLane()) {
                            didReadFromEntangledAsyncAction = true;
                        }
                        continue;
                    }
                    else {
                        const clone: Update<unknown, unknown> = {
                            // Once we commit an optimistic update, we shouldn't uncommit it
                            // until the transition it is associated with has finished
                            // (represented by revertLane). Using NoLane here works because 0
                            // is a subset of all bitmasks, so this will never be skipped by
                            // the check above.
                            lane: NoLane,
                            // Reuse the same revertLane so we know when the transition
                            // has finished.
                            revertLane: update!.revertLane,
                            gesture: null,
                            action: update!.action,
                            hasEagerState: update!.hasEagerState,
                            eagerState: update!.eagerState,
                            next: null,
                        };
                        if (newBaseQueueLast === null) {
                            newBaseQueueFirst = newBaseQueueLast = clone;
                            newBaseState = newState;
                        }
                        else {
                            newBaseQueueLast = newBaseQueueLast.next = clone;
                        }
                        // Update the remaining priority in the queue.
                        // TODO: Don't need to accumulate this. Instead, we can remove
                        // renderLanes from the original lanes.
                        currentlyRenderingFiber!.lanes = mergeLanes(currentlyRenderingFiber!.lanes, revertLane);
                        markSkippedUpdateLanes(revertLane);
                    }
                }
                // Process this update.
                const action = update!.action;
                if (shouldDoubleInvokeUserFnsInHooksDEV) {
                    reducer(newState, action);
                }
                if (update!.hasEagerState) {
                    // If this update is a state update (not a reducer) and was processed eagerly,
                    // we can use the eagerly computed state
                    newState = (update!.eagerState as unknown);
                }
                else {
                    newState = reducer(newState, action);
                }
            }
            update = update!.next;
        } while (update !== null && update !== first);
        if (newBaseQueueLast === null) {
            newBaseState = newState;
        }
        else {
            newBaseQueueLast.next = (newBaseQueueFirst);
        }
        // Mark that the fiber performed work, but only if the new state is
        // different from the current state.
        if (!is(newState, hook.memoizedState)) {
            markWorkInProgressReceivedUpdate();
            // Check if this update is part of a pending async action. If so, we'll
            // need to suspend until the action has finished, so that it's batched
            // together with future updates in the same action.
            // TODO: Once we support hooks inside useMemo (or an equivalent
            // memoization boundary like Forget), hoist this logic so that it only
            // suspends if the memo boundary produces a new value.
            if (didReadFromEntangledAsyncAction) {
                const entangledActionThenable = peekEntangledActionThenable();
                if (entangledActionThenable !== null) {
                    // TODO: Instead of the throwing the thenable directly, throw a
                    // special object like `use` does so we can detect if it's captured
                    // by userspace.
                    throw entangledActionThenable;
                }
            }
        }
        hook.memoizedState = newState;
        hook.baseState = newBaseState;
        hook.baseQueue = newBaseQueueLast;
        queue.lastRenderedState = newState;
    }
    if (baseQueue === null) {
        // `queue.lanes` is used for entangling transitions. We can set it back to
        // zero once the queue is empty.
        queue.lanes = NoLanes;
    }
    const dispatch: Dispatch<unknown> = (queue.dispatch);
    return [hook.memoizedState, dispatch];
}
function rerenderReducer(reducer: (arg1: unknown, arg2: unknown) => unknown, initialArg: unknown, init?: (arg1: unknown) => unknown): [
    unknown,
    Dispatch<unknown>
] {
    const hook = updateWorkInProgressHook();
    const queue = hook.queue;
    if (queue === null) {
        throw new Error('Should have a queue. You are likely calling Hooks conditionally, ' +
            'which is not allowed. (https://react.dev/link/invalid-hook-call)');
    }
    queue.lastRenderedReducer = reducer;
    // This is a re-render. Apply the new render phase updates to the previous
    // work-in-progress hook.
    const dispatch: Dispatch<unknown> = (queue.dispatch);
    const lastRenderPhaseUpdate = queue.pending;
    let newState = hook.memoizedState;
    if (lastRenderPhaseUpdate !== null) {
        // The queue doesn't persist past this render pass.
        queue.pending = null;
        const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next;
        let update = firstRenderPhaseUpdate;
        do {
            // Process this render phase update. We don't have to check the
            // priority because it will always be the same as the current
            // render's.
            const action = update.action;
            newState = reducer(newState, action);
            update = update.next;
        } while (update !== firstRenderPhaseUpdate);
        // Mark that the fiber performed work, but only if the new state is
        // different from the current state.
        if (!is(newState, hook.memoizedState)) {
            markWorkInProgressReceivedUpdate();
        }
        hook.memoizedState = newState;
        // Don't persist the state accumulated from the render phase updates to
        // the base state unless the queue is empty.
        // TODO: Not sure if this is the desired semantics, but it's what we
        // do for gDSFP. I can't remember why.
        if (hook.baseQueue === null) {
            hook.baseState = newState;
        }
        queue.lastRenderedState = newState;
    }
    return [newState, dispatch];
}
function mountSyncExternalStore(subscribe: (arg1: () => void) => () => void, getSnapshot: () => unknown, getServerSnapshot?: () => unknown): unknown {
    const fiber = currentlyRenderingFiber!;
    const hook = mountWorkInProgressHook();
    let nextSnapshot;
    const isHydrating = getIsHydrating();
    if (isHydrating) {
        if (getServerSnapshot === undefined) {
            throw new Error('Missing getServerSnapshot, which is required for ' +
                'server-rendered content. Will revert to client rendering.');
        }
        nextSnapshot = getServerSnapshot();
        ;
    }
    else {
        nextSnapshot = getSnapshot();
        ;
        // Unless we're rendering a blocking lane, schedule a consistency check.
        // Right before committing, we will walk the tree and check if any of the
        // stores were mutated.
        //
        // We won't do this if we're hydrating server-rendered content, because if
        // the content is stale, it's already visible anyway. Instead we'll patch
        // it up in a passive effect.
        const root: FiberRoot | null = getWorkInProgressRoot();
        if (root === null) {
            throw new Error('Expected a work-in-progress root. This is a bug in React. Please file an issue.');
        }
        const rootRenderLanes = getWorkInProgressRootRenderLanes();
        if (!includesBlockingLane(rootRenderLanes)) {
            pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
        }
    }
    // Read the current snapshot from the store on every render. This breaks the
    // normal rules of React, and only works because store updates are
    // always synchronous.
    hook.memoizedState = nextSnapshot;
    const inst: StoreInstance<unknown> = {
        value: nextSnapshot,
        getSnapshot,
    };
    hook.queue = inst;
    // Schedule an effect to subscribe to the store.
    mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);
    // Schedule an effect to update the mutable instance fields. We will update
    // this whenever subscribe, getSnapshot, or value changes. Because there's no
    // clean-up function, and we track the deps correctly, we can call pushEffect
    // directly, without storing any additional state. For the same reason, we
    // don't need to set a static flag, either.
    fiber!.flags |= PassiveEffect;
    pushSimpleEffect(HookHasEffect | HookPassive, createEffectInstance(), updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot), null);
    return nextSnapshot;
}
function updateSyncExternalStore(subscribe: (arg1: () => void) => () => void, getSnapshot: () => unknown, getServerSnapshot?: () => unknown): unknown {
    const fiber = currentlyRenderingFiber!;
    const hook = updateWorkInProgressHook();
    // Read the current snapshot from the store on every render. This breaks the
    // normal rules of React, and only works because store updates are
    // always synchronous.
    let nextSnapshot;
    const isHydrating = getIsHydrating();
    if (isHydrating) {
        // Needed for strict mode double render
        if (getServerSnapshot === undefined) {
            throw new Error('Missing getServerSnapshot, which is required for ' +
                'server-rendered content. Will revert to client rendering.');
        }
        nextSnapshot = getServerSnapshot();
    }
    else {
        nextSnapshot = getSnapshot();
        ;
    }
    const prevSnapshot = (currentHook || hook).memoizedState;
    const snapshotChanged = !is(prevSnapshot, nextSnapshot);
    if (snapshotChanged) {
        hook.memoizedState = nextSnapshot;
        markWorkInProgressReceivedUpdate();
    }
    const inst = hook.queue;
    updateEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [
        subscribe,
    ]);
    // Whenever getSnapshot or subscribe changes, we need to check in the
    // commit phase if there was an interleaved mutation. In concurrent mode
    // this can happen all the time, but even in synchronous mode, an earlier
    // effect may have mutated the store.
    if (inst.getSnapshot !== getSnapshot ||
        snapshotChanged ||
        // Check if the subscribe function changed. We can save some memory by
        // checking whether we scheduled a subscription effect above.
        (workInProgressHook !== null &&
            workInProgressHook.memoizedState.tag & HookHasEffect)) {
        fiber!.flags |= PassiveEffect;
        pushSimpleEffect(HookHasEffect | HookPassive, createEffectInstance(), updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot), null);
        // Unless we're rendering a blocking lane, schedule a consistency check.
        // Right before committing, we will walk the tree and check if any of the
        // stores were mutated.
        const root: FiberRoot | null = getWorkInProgressRoot();
        if (root === null) {
            throw new Error('Expected a work-in-progress root. This is a bug in React. Please file an issue.');
        }
        if (!isHydrating && !includesBlockingLane(renderLanes)) {
            pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
        }
    }
    return nextSnapshot;
}
function pushStoreConsistencyCheck(fiber: Fiber, getSnapshot: () => unknown, renderedSnapshot: unknown): void {
    fiber.flags |= StoreConsistency;
    const check: StoreConsistencyCheck<unknown> = {
        getSnapshot,
        value: renderedSnapshot,
    };
    let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber!.updateQueue as FunctionComponentUpdateQueue | null);
    if (componentUpdateQueue === null) {
        componentUpdateQueue = createFunctionComponentUpdateQueue();
        currentlyRenderingFiber!.updateQueue = (componentUpdateQueue);
        componentUpdateQueue.stores = [check];
    }
    else {
        const stores = componentUpdateQueue.stores;
        if (stores === null) {
            componentUpdateQueue.stores = [check];
        }
        else {
            stores.push(check);
        }
    }
}
function updateStoreInstance(fiber: Fiber, inst: StoreInstance<unknown>, nextSnapshot: unknown, getSnapshot: () => unknown): void {
    // These are updated in the passive phase
    inst.value = nextSnapshot;
    inst.getSnapshot = getSnapshot;
    // Something may have been mutated in between render and commit. This could
    // have been in an event that fired before the passive effects, or it could
    // have been in a layout effect. In that case, we would have used the old
    // snapsho and getSnapshot values to bail out. We need to check one more time.
    if (checkIfSnapshotChanged(inst)) {
        // Force a re-render.
        // We intentionally don't log update times and stacks here because this
        // was not an external trigger but rather an internal one.
        forceStoreRerender(fiber);
    }
}
function subscribeToStore(fiber: Fiber, inst: StoreInstance<unknown>, subscribe: (arg1: () => void) => () => void): any {
    const handleStoreChange = () => {
        // The store changed. Check if the snapshot changed since the last time we
        // read from the store.
        if (checkIfSnapshotChanged(inst)) {
            // Force a re-render.
            startUpdateTimerByLane(SyncLane, 'updateSyncExternalStore()', fiber);
            forceStoreRerender(fiber);
        }
    };
    // Subscribe to the store and return a clean-up function.
    return subscribe(handleStoreChange);
}
function checkIfSnapshotChanged(inst: StoreInstance<unknown>): boolean {
    const latestGetSnapshot = inst.getSnapshot;
    const prevValue = inst.value;
    try {
        const nextValue = latestGetSnapshot();
        return !is(prevValue, nextValue);
    }
    catch (error: unknown) {
        return true;
    }
}
function forceStoreRerender(fiber: Fiber) {
    const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
    if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
    }
}
function mountStateImpl(initialState: (() => unknown) | unknown): Hook {
    const hook = mountWorkInProgressHook();
    if (typeof initialState === 'function') {
        const initialStateInitializer = initialState as () => unknown;
        initialState = initialStateInitializer();
        if (shouldDoubleInvokeUserFnsInHooksDEV) {
            setIsStrictModeForDevtools(true);
            try {
                initialStateInitializer();
            }
            finally {
                setIsStrictModeForDevtools(false);
            }
        }
    }
    hook.memoizedState = hook.baseState = initialState;
    const queue: UpdateQueue<unknown, BasicStateAction<unknown>> = {
        pending: null,
        lanes: NoLanes,
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: (initialState),
    };
    hook.queue = queue;
    return hook;
}
function mountState(initialState: (() => unknown) | unknown): [
    unknown,
    Dispatch<BasicStateAction<unknown>>
] {
    const hook = mountStateImpl(initialState);
    const queue: UpdateQueue<unknown, BasicStateAction<unknown>> = hook.queue;
    const dispatch: Dispatch<BasicStateAction<unknown>> = dispatchSetState.bind(null, currentlyRenderingFiber!, queue);
    queue.dispatch = dispatch;
    return [hook.memoizedState, dispatch];
}
function updateState(initialState: (() => unknown) | unknown): [
    unknown,
    Dispatch<BasicStateAction<unknown>>
] {
    return updateReducer(basicStateReducer, initialState);
}
function rerenderState(initialState: (() => unknown) | unknown): [
    unknown,
    Dispatch<BasicStateAction<unknown>>
] {
    return rerenderReducer(basicStateReducer, initialState);
}
function mountOptimistic(passthrough: unknown, reducer?: ((arg1: unknown, arg2: unknown) => unknown) | null): [
    unknown,
    (arg1: unknown) => void
] {
    const hook = mountWorkInProgressHook();
    hook.memoizedState = hook.baseState = passthrough;
    const queue: UpdateQueue<unknown, unknown> = {
        pending: null,
        lanes: NoLanes,
        dispatch: null,
        // Optimistic state does not use the eager update optimization.
        lastRenderedReducer: null,
        lastRenderedState: null,
    };
    hook.queue = queue;
    // This is different than the normal setState function.
    const dispatch: (arg1: unknown) => void = dispatchOptimisticSetState.bind(null, currentlyRenderingFiber!, true, queue);
    queue.dispatch = dispatch;
    return [passthrough, dispatch];
}
function updateOptimistic(passthrough: unknown, reducer?: ((arg1: unknown, arg2: unknown) => unknown) | null): [
    unknown,
    (arg1: unknown) => void
] {
    const hook = updateWorkInProgressHook();
    return updateOptimisticImpl(hook, (currentHook as Hook), passthrough, reducer);
}
function updateOptimisticImpl(hook: Hook, current: Hook | null, passthrough: unknown, reducer?: ((arg1: unknown, arg2: unknown) => unknown) | null): [
    unknown,
    (arg1: unknown) => void
] {
    // Optimistic updates are always rebased on top of the latest value passed in
    // as an argument. It's called a passthrough because if there are no pending
    // updates, it will be returned as-is.
    //
    // Reset the base state to the passthrough. Future updates will be applied
    // on top of this.
    hook.baseState = passthrough;
    // If a reducer is not provided, default to the same one used by useState.
    const resolvedReducer: (arg1: unknown, arg2: unknown) => unknown = typeof reducer === 'function' ? reducer : (basicStateReducer as (arg1: unknown, arg2: unknown) => unknown);
    return updateReducerImpl(hook, (currentHook as Hook), resolvedReducer);
}
function rerenderOptimistic(passthrough: unknown, reducer?: ((arg1: unknown, arg2: unknown) => unknown) | null): [
    unknown,
    (arg1: unknown) => void
] {
    // Unlike useState, useOptimistic doesn't support render phase updates.
    // Also unlike useState, we need to replay all pending updates again in case
    // the passthrough value changed.
    //
    // So instead of a forked re-render implementation that knows how to handle
    // render phase udpates, we can use the same implementation as during a
    // regular mount or update.
    const hook = updateWorkInProgressHook();
    if (currentHook !== null) {
        // This is an update. Process the update queue.
        return updateOptimisticImpl(hook, (currentHook as Hook), passthrough, reducer);
    }
    // This is a mount. No updates to process.
    // Reset the base state to the passthrough. Future updates will be applied
    // on top of this.
    hook.baseState = passthrough;
    const dispatch = hook.queue.dispatch;
    return [passthrough, dispatch];
}
// useActionState actions run sequentially, because each action receives the
// previous state as an argument. We store pending actions on a queue.
type ActionStateQueue<S, P> = {
    // This is the most recent state returned from an action. It's updated as
    // soon as the action finishes running.
    state: Awaited<unknown>;
    // A stable dispatch method, passed to the user (set right after the queue is created).
    dispatch: Dispatch<unknown> | null;
    // This is the most recent action function that was rendered. It's updated
    // during the commit phase.
    // If it's null, it means the action queue errored and subsequent actions
    // should not run.
    action: ((arg1: Awaited<unknown>, arg2: unknown) => unknown) | null;
    // This is a circular linked list of pending action payloads. It incudes the
    // action that is currently running.
    pending: ActionStateQueueNode<unknown, unknown> | null;
};
type ActionStateQueueNode<S, P> = {
    payload: unknown;
    // This is the action implementation at the time it was dispatched.
    action: (arg1: Awaited<unknown>, arg2: unknown) => unknown;
    // Part of a circular linked list: set right after the node is created.
    next: ActionStateQueueNode<unknown, unknown> | null;
    // Whether or not the action was dispatched as part of a transition. We use
    // this to restore the transition context when the queued action is run. Once
    // we're able to track parallel async actions, this should be updated to
    // represent the specific transition instance the action is associated with.
    isTransition: boolean;
    // Implements the Thenable interface. We use it to suspend until the action
    // finishes.
    then: (listener: () => void) => void;
    status: 'pending' | 'rejected' | 'fulfilled';
    value: unknown;
    reason: unknown;
    listeners: Array<() => void>;
};
function dispatchActionState(fiber: Fiber, actionQueue: ActionStateQueue<unknown, unknown>, setPendingState: (arg1: boolean) => void, setState: Dispatch<ActionStateQueueNode<unknown, unknown>>, payload: unknown): void {
    if (isRenderPhaseUpdate(fiber)) {
        throw new Error('Cannot update form state while rendering.');
    }
    const currentAction = actionQueue.action;
    if (currentAction === null) {
        // An earlier action errored. Subsequent actions should not run.
        return;
    }
    const actionNode: ActionStateQueueNode<unknown, unknown> = {
        payload,
        action: currentAction,
        next: null,
        isTransition: true,
        status: 'pending',
        value: null,
        reason: null,
        listeners: [],
        then(listener: () => void) {
            // We know the only thing that subscribes to these promises is `use` so
            // this implementation is simpler than a generic thenable. E.g. we don't
            // bother to check if the thenable is still pending because `use` already
            // does that.
            actionNode.listeners.push(listener);
        },
    };
    // Check if we're inside a transition. If so, we'll need to restore the
    // transition context when the action is run.
    const prevTransition = ReactSharedInternals.T;
    if (prevTransition !== null) {
        // Optimistically update the pending state, similar to useTransition.
        // This will be reverted automatically when all actions are finished.
        setPendingState(true);
        // `actionNode` is a thenable that resolves to the return value of
        // the action.
        setState(actionNode);
    }
    else {
        // This is not a transition.
        actionNode.isTransition = false;
        setState(actionNode);
    }
    const last = actionQueue.pending;
    if (last === null) {
        // There are no pending actions; this is the first one. We can run
        // it immediately.
        actionNode.next = actionQueue.pending = actionNode;
        runActionStateAction(actionQueue, actionNode);
    }
    else {
        // There's already an action running. Add to the queue.
        const first = last.next;
        actionNode.next = first;
        actionQueue.pending = last.next = actionNode;
    }
}
function runActionStateAction(actionQueue: ActionStateQueue<unknown, unknown>, node: ActionStateQueueNode<unknown, unknown>) {
    // `node.action` represents the action function at the time it was dispatched.
    // If this action was queued, it might be stale, i.e. it's not necessarily the
    // most current implementation of the action, stored on `actionQueue`. This is
    // intentional. The conceptual model for queued actions is that they are
    // queued in a remote worker; the dispatch happens immediately, only the
    // execution is delayed.
    const action = node.action;
    const payload = node.payload;
    const prevState = actionQueue.state;
    if (node.isTransition) {
        // The original dispatch was part of a transition. We restore its
        // transition context here.
        // This is a fork of startTransition
        const prevTransition = ReactSharedInternals.T;
        const currentTransition: Transition = { types: undefined }; // React's ({}): `types` reads undefined
        ;
        ;
        ;
        ;
        ReactSharedInternals.T = currentTransition;
        try {
            const returnValue = action(prevState, payload);
            const onStartTransitionFinish = ReactSharedInternals.S;
            if (onStartTransitionFinish !== null) {
                onStartTransitionFinish(currentTransition, returnValue);
            }
            handleActionReturnValue(actionQueue, node, returnValue);
        }
        catch (error: unknown) {
            onActionError(actionQueue, node, error);
        }
        finally {
            if (prevTransition !== null && currentTransition.types !== null) {
                ;
                prevTransition.types = currentTransition.types;
            }
            ReactSharedInternals.T = prevTransition;
            ;
        }
    }
    else {
        // The original dispatch was not part of a transition.
        try {
            const returnValue = action(prevState, payload);
            handleActionReturnValue(actionQueue, node, returnValue);
        }
        catch (error: unknown) {
            onActionError(actionQueue, node, error);
        }
    }
}
function handleActionReturnValue(actionQueue: ActionStateQueue<unknown, unknown>, node: ActionStateQueueNode<unknown, unknown>, returnValue: unknown) {
    if (returnValue !== null &&
        typeof returnValue === 'object' &&
        typeof readProperty(returnValue as object, 'then') === 'function') {
        const thenable = (returnValue as Thenable<Awaited<unknown>>);
        ;
        // Attach a listener to read the return state of the action. As soon as
        // this resolves, we can run the next action in the sequence.
        thenable.then((nextState: Awaited<unknown>) => {
            onActionSuccess(actionQueue, node, nextState);
        }, (error: unknown) => onActionError(actionQueue, node, error));
        ;
    }
    else {
        const nextState = (returnValue as Awaited<unknown>);
        onActionSuccess(actionQueue, node, nextState);
    }
}
function onActionSuccess(actionQueue: ActionStateQueue<unknown, unknown>, actionNode: ActionStateQueueNode<unknown, unknown>, nextState: Awaited<unknown>) {
    // The action finished running.
    actionNode.status = 'fulfilled';
    actionNode.value = nextState;
    notifyActionListeners(actionNode);
    actionQueue.state = nextState;
    // Pop the action from the queue and run the next pending action, if there
    // are any.
    const last = actionQueue.pending;
    if (last !== null) {
        const first = last.next;
        if (first === last) {
            // This was the last action in the queue.
            actionQueue.pending = null;
        }
        else {
            // Remove the first node from the circular queue.
            const next = first!.next!;
            last.next = next;
            // Run the next action.
            runActionStateAction(actionQueue, next);
        }
    }
}
function onActionError(actionQueue: ActionStateQueue<unknown, unknown>, actionNode: ActionStateQueueNode<unknown, unknown>, error: unknown) {
    // Mark all the following actions as rejected.
    const last = actionQueue.pending;
    actionQueue.pending = null;
    if (last !== null) {
        const first = last.next;
        do {
            actionNode.status = 'rejected';
            actionNode.reason = error;
            notifyActionListeners(actionNode);
            actionNode = actionNode.next!;
        } while (actionNode !== first);
    }
    // Prevent subsequent actions from being dispatched.
    actionQueue.action = null;
}
function notifyActionListeners(actionNode: ActionStateQueueNode<unknown, unknown>) {
    // Notify React that the action has finished.
    const listeners = actionNode.listeners;
    for (let i = 0; i < listeners.length; i++) {
        // This is always a React internal listener, so we don't need to worry
        // about it throwing.
        const listener = listeners[i];
        listener();
    }
}
function actionStateReducer(oldState: unknown, newState: unknown): unknown {
    return newState;
}
function mountActionState(action: (arg1: Awaited<unknown>, arg2: unknown) => unknown, initialStateProp: Awaited<unknown>, permalink?: string): [
    Awaited<unknown>,
    (arg1: unknown) => void,
    boolean
] {
    let initialState: Awaited<unknown> = initialStateProp;
    if (getIsHydrating()) {
        const root: FiberRoot = (getWorkInProgressRoot()!);
        const ssrFormState = root.formState;
        // If a formState option was passed to the root, there are form state
        // markers that we need to hydrate. These indicate whether the form state
        // matches this hook instance.
        if (ssrFormState !== null) {
            const isMatching = tryToClaimNextHydratableFormMarkerInstance(currentlyRenderingFiber!);
            if (isMatching) {
                initialState = ssrFormState[0];
            }
        }
    }
    // State hook. The state is stored in a thenable which is then unwrapped by
    // the `use` algorithm during render.
    const stateHook = mountWorkInProgressHook();
    stateHook.memoizedState = stateHook.baseState = initialState;
    // TODO: Typing this "correctly" results in recursion limit errors
    // const stateQueue: UpdateQueue<S | Awaited<S>, S | Awaited<S>> = {
    // The state queue also receives queued action nodes (thenables the reducer returns as the new state).
    const stateQueue: UpdateQueue<unknown | Awaited<unknown> | ActionStateQueueNode<unknown, unknown>, unknown | Awaited<unknown> | ActionStateQueueNode<unknown, unknown>> = {
        pending: null,
        lanes: NoLanes,
        dispatch: null,
        lastRenderedReducer: actionStateReducer,
        lastRenderedState: initialState,
    };
    stateHook.queue = stateQueue;
    const setState: Dispatch<unknown | Awaited<unknown> | ActionStateQueueNode<unknown, unknown>> = dispatchSetState.bind(null, currentlyRenderingFiber!, stateQueue);
    stateQueue.dispatch = setState;
    // Pending state. This is used to store the pending state of the action.
    // Tracked optimistically, like a transition pending state.
    const pendingStateHook = mountStateImpl((false as Thenable<boolean> | boolean));
    const pendingStateQueue: UpdateQueue<Thenable<boolean> | boolean, BasicStateAction<Thenable<boolean> | boolean>> = pendingStateHook.queue;
    const setPendingState: (arg1: boolean) => void = (dispatchOptimisticSetState).bind(null, currentlyRenderingFiber!, false, pendingStateQueue);
    // Action queue hook. This is used to queue pending actions. The queue is
    // shared between all instances of the hook. Similar to a regular state queue,
    // but different because the actions are run sequentially, and they run in
    // an event instead of during render.
    const actionQueueHook = mountWorkInProgressHook();
    const actionQueue: ActionStateQueue<unknown, unknown> = {
        state: initialState,
        dispatch: null,
        action,
        pending: null,
    };
    actionQueueHook.queue = actionQueue;
    const dispatch: Dispatch<unknown> = dispatchActionState.bind(null, currentlyRenderingFiber!, actionQueue, setPendingState, setState);
    actionQueue.dispatch = dispatch;
    // Stash the action function on the memoized state of the hook. We'll use this
    // to detect when the action function changes so we can update it in
    // an effect.
    actionQueueHook.memoizedState = action;
    return [initialState, dispatch, false];
}
function updateActionState(action: (arg1: Awaited<unknown>, arg2: unknown) => unknown, initialState: Awaited<unknown>, permalink?: string): [
    Awaited<unknown>,
    (arg1: unknown) => void,
    boolean
] {
    const stateHook = updateWorkInProgressHook();
    const currentStateHook = (currentHook as Hook);
    return updateActionStateImpl(stateHook, currentStateHook, action, initialState, permalink);
}
function updateActionStateImpl(stateHook: Hook, currentStateHook: Hook, action: (arg1: Awaited<unknown>, arg2: unknown) => unknown, initialState: Awaited<unknown>, permalink?: string): [
    Awaited<unknown>,
    (arg1: unknown) => void,
    boolean
] {
    const [actionResult] = updateReducerImpl(stateHook, currentStateHook, actionStateReducer);
    const [isPending] = updateState(false);
    // This will suspend until the action finishes.
    let state: Awaited<unknown>;
    if (typeof actionResult === 'object' &&
        actionResult !== null &&
        typeof (actionResult as Thenable<unknown>).then === 'function') {
        try {
            state = useThenable((actionResult as Thenable<Awaited<unknown>>));
        }
        catch (x: unknown) {
            if (x === SuspenseException) {
                // If we Suspend here, mark this separately so that we can track this
                // as an Action in Profiling tools.
                throw SuspenseActionException;
            }
            else {
                throw x;
            }
        }
    }
    else {
        state = (actionResult as unknown);
    }
    const actionQueueHook = updateWorkInProgressHook();
    const actionQueue = actionQueueHook.queue;
    const dispatch = actionQueue.dispatch;
    // Check if a new action was passed. If so, update it in an effect.
    const prevAction = actionQueueHook.memoizedState;
    if (action !== prevAction) {
        currentlyRenderingFiber!.flags |= PassiveEffect;
        pushSimpleEffect(HookHasEffect | HookPassive, createEffectInstance(), actionStateActionEffect.bind(null, actionQueue, action), null);
    }
    return [state, dispatch, isPending as boolean];
}
function actionStateActionEffect(actionQueue: ActionStateQueue<unknown, unknown>, action: (arg1: Awaited<unknown>, arg2: unknown) => unknown): void {
    actionQueue.action = action;
}
function rerenderActionState(action: (arg1: Awaited<unknown>, arg2: unknown) => unknown, initialState: Awaited<unknown>, permalink?: string): [
    Awaited<unknown>,
    (arg1: unknown) => void,
    boolean
] {
    // Unlike useState, useActionState doesn't support render phase updates.
    // Also unlike useState, we need to replay all pending updates again in case
    // the passthrough value changed.
    //
    // So instead of a forked re-render implementation that knows how to handle
    // render phase udpates, we can use the same implementation as during a
    // regular mount or update.
    const stateHook = updateWorkInProgressHook();
    const currentStateHook = currentHook;
    if (currentStateHook !== null) {
        // This is an update. Process the update queue.
        return updateActionStateImpl(stateHook, currentStateHook, action, initialState, permalink);
    }
    updateWorkInProgressHook(); // State
    // This is a mount. No updates to process.
    const state: Awaited<unknown> = stateHook.memoizedState;
    const actionQueueHook = updateWorkInProgressHook();
    const actionQueue = actionQueueHook.queue;
    const dispatch = actionQueue.dispatch;
    // This may have changed during the rerender.
    actionQueueHook.memoizedState = action;
    // For mount, pending is always false.
    return [state, dispatch, false];
}
function pushSimpleEffect(tag: HookFlags, inst: EffectInstance, create: () => (() => void) | void, deps: Array<unknown> | null): Effect {
    const effect: Effect = {
        tag,
        create,
        deps,
        inst,
        // Circular
        next: null,
    };
    return pushEffectImpl(effect);
}
function pushEffectImpl(effect: Effect): Effect {
    let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber!.updateQueue as FunctionComponentUpdateQueue | null);
    if (componentUpdateQueue === null) {
        componentUpdateQueue = createFunctionComponentUpdateQueue();
        currentlyRenderingFiber!.updateQueue = (componentUpdateQueue);
    }
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
        componentUpdateQueue.lastEffect = effect.next = effect;
    }
    else {
        const firstEffect = lastEffect.next;
        lastEffect.next = effect;
        effect.next = firstEffect;
        componentUpdateQueue.lastEffect = effect;
    }
    return effect;
}
function createEffectInstance(): EffectInstance {
    return { destroy: undefined };
}
function mountRef(initialValue: unknown): {
    current: unknown;
} {
    const hook = mountWorkInProgressHook();
    const ref = { current: initialValue } as const;
    hook.memoizedState = ref;
    return ref;
}
function updateRef(initialValue: unknown): {
    current: unknown;
} {
    const hook = updateWorkInProgressHook();
    return hook.memoizedState;
}
function mountEffectImpl(fiberFlags: Flags, hookFlags: HookFlags, create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    const hook = mountWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    currentlyRenderingFiber!.flags |= fiberFlags;
    hook.memoizedState = pushSimpleEffect(HookHasEffect | hookFlags, createEffectInstance(), create, nextDeps);
}
function updateEffectImpl(fiberFlags: Flags, hookFlags: HookFlags, create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    const hook = updateWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    const effect: Effect = hook.memoizedState;
    const inst = effect.inst;
    // currentHook is null on initial mount when rerendering after a render phase
    // state update or for strict mode.
    if (currentHook !== null) {
        if (nextDeps !== null) {
            const prevEffect: Effect = currentHook.memoizedState;
            const prevDeps = prevEffect.deps;
            if (areHookInputsEqual(nextDeps, prevDeps)) {
                hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, nextDeps);
                return;
            }
        }
    }
    currentlyRenderingFiber!.flags |= fiberFlags;
    hook.memoizedState = pushSimpleEffect(HookHasEffect | hookFlags, inst, create, nextDeps);
}
function mountEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    {
        mountEffectImpl(PassiveEffect | PassiveStaticEffect, HookPassive, create, deps);
    }
}
function updateEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    updateEffectImpl(PassiveEffect, HookPassive, create, deps);
}
function useEffectEventImpl(payload: EventFunctionPayload<EventFunction>) {
    currentlyRenderingFiber!.flags |= UpdateEffect;
    let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber!.updateQueue as FunctionComponentUpdateQueue | null);
    if (componentUpdateQueue === null) {
        componentUpdateQueue = createFunctionComponentUpdateQueue();
        currentlyRenderingFiber!.updateQueue = (componentUpdateQueue);
        componentUpdateQueue.events = [payload];
    }
    else {
        const events = componentUpdateQueue.events;
        if (events === null) {
            componentUpdateQueue.events = [payload];
        }
        else {
            events.push(payload);
        }
    }
}
function mountEvent(callback: EventFunction): EventFunction {
    const hook = mountWorkInProgressHook();
    const ref: {
        impl: EventFunction;
    } = { impl: callback };
    hook.memoizedState = ref;
    return function eventFn(...args: Array<unknown>) {
        if (isInvalidExecutionContextForEventFunction()) {
            throw new Error("A function wrapped in useEffectEvent can't be called during rendering.");
        }
        return ref.impl.apply(undefined, args);
    };
}
function updateEvent(callback: EventFunction): EventFunction {
    const hook = updateWorkInProgressHook();
    const ref: {
        eventFn: EventFunction;
        impl: EventFunction;
    } = hook.memoizedState;
    useEffectEventImpl({ ref, nextImpl: callback });
    return function eventFn(...args: Array<unknown>) {
        if (isInvalidExecutionContextForEventFunction()) {
            throw new Error("A function wrapped in useEffectEvent can't be called during rendering.");
        }
        return ref.impl.apply(undefined, args);
    };
}
function mountInsertionEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    mountEffectImpl(UpdateEffect, HookInsertion, create, deps);
}
function updateInsertionEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    return updateEffectImpl(UpdateEffect, HookInsertion, create, deps);
}
function mountLayoutEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect;
    ;
    return mountEffectImpl(fiberFlags, HookLayout, create, deps);
}
function updateLayoutEffect(create: () => (() => void) | void, deps?: Array<unknown> | null): void {
    return updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}
// The ref is a ref object, a ref callback, or null/undefined (HookRef), narrowed here as React narrows it.
type RefCallback = (instance: unknown) => unknown;
type RefObject = {
    current: unknown;
};
function imperativeHandleEffect(create: () => unknown, ref?: unknown): undefined | (() => void) {
    if (typeof ref === 'function') {
        const refCallback = ref as RefCallback;
        const inst = create();
        const refCleanup = refCallback(inst);
        return () => {
            if (typeof refCleanup === 'function') {
                refCleanup();
            }
            else {
                refCallback(null);
            }
        };
    }
    else if (ref !== null && ref !== undefined) {
        const refObject = ref as RefObject;
        ;
        const inst = create();
        refObject.current = inst;
        return () => {
            refObject.current = null;
        };
    }
}
function mountImperativeHandle(ref: unknown, create: () => unknown, deps?: Array<unknown> | null): void {
    ;
    // TODO: If deps are provided, should we skip comparing the ref itself?
    const effectDeps = deps !== null && deps !== undefined ? deps.concat([ref]) : null;
    let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect;
    ;
    mountEffectImpl(fiberFlags, HookLayout, imperativeHandleEffect.bind(null, create, ref), effectDeps);
}
function updateImperativeHandle(ref: unknown, create: () => unknown, deps?: Array<unknown> | null): void {
    ;
    // TODO: If deps are provided, should we skip comparing the ref itself?
    const effectDeps = deps !== null && deps !== undefined ? deps.concat([ref]) : null;
    updateEffectImpl(UpdateEffect, HookLayout, imperativeHandleEffect.bind(null, create, ref), effectDeps);
}
function mountDebugValue(value: unknown, formatterFn?: ((value: unknown) => unknown) | null): void {
    // This hook is normally a no-op.
    // The react-debug-hooks package injects its own implementation
    // so that e.g. DevTools can display custom hook values.
}
function mountCallback(callback: unknown, deps?: Array<unknown> | null): unknown {
    const hook = mountWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    hook.memoizedState = [callback, nextDeps];
    return callback;
}
function updateCallback(callback: unknown, deps?: Array<unknown> | null): unknown {
    const hook = updateWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    const prevState = hook.memoizedState;
    if (nextDeps !== null) {
        const prevDeps: Array<unknown> | null = prevState[1];
        if (areHookInputsEqual(nextDeps, prevDeps)) {
            return prevState[0];
        }
    }
    hook.memoizedState = [callback, nextDeps];
    return callback;
}
function mountMemo(nextCreate: () => unknown, deps?: Array<unknown> | null): unknown {
    const hook = mountWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    const nextValue = nextCreate();
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
        setIsStrictModeForDevtools(true);
        try {
            nextCreate();
        }
        finally {
            setIsStrictModeForDevtools(false);
        }
    }
    hook.memoizedState = [nextValue, nextDeps];
    return nextValue;
}
function updateMemo(nextCreate: () => unknown, deps?: Array<unknown> | null): unknown {
    const hook = updateWorkInProgressHook();
    const nextDeps = deps === undefined ? null : deps;
    const prevState = hook.memoizedState;
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) {
        const prevDeps: Array<unknown> | null = prevState[1];
        if (areHookInputsEqual(nextDeps, prevDeps)) {
            return prevState[0];
        }
    }
    const nextValue = nextCreate();
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
        setIsStrictModeForDevtools(true);
        try {
            nextCreate();
        }
        finally {
            setIsStrictModeForDevtools(false);
        }
    }
    hook.memoizedState = [nextValue, nextDeps];
    return nextValue;
}
function mountDeferredValue(value: unknown, initialValue?: unknown): unknown {
    const hook = mountWorkInProgressHook();
    return mountDeferredValueImpl(hook, value, initialValue);
}
function updateDeferredValue(value: unknown, initialValue?: unknown): unknown {
    const hook = updateWorkInProgressHook();
    const resolvedCurrentHook: Hook = (currentHook!);
    const prevValue: unknown = resolvedCurrentHook.memoizedState;
    return updateDeferredValueImpl(hook, prevValue, value, initialValue);
}
function rerenderDeferredValue(value: unknown, initialValue?: unknown): unknown {
    const hook = updateWorkInProgressHook();
    if (currentHook === null) {
        // This is a rerender during a mount.
        return mountDeferredValueImpl(hook, value, initialValue);
    }
    else {
        // This is a rerender during an update.
        const prevValue: unknown = currentHook.memoizedState;
        return updateDeferredValueImpl(hook, prevValue, value, initialValue);
    }
}
function isRenderingDeferredWork(): boolean {
    if (!includesSomeLane(renderLanes, DeferredLane)) {
        // None of the render lanes are deferred lanes.
        return false;
    }
    // At least one of the render lanes are deferred lanes. However, if the
    // current render is also batched together with an update, then we can't
    // say that the render is wholly the result of deferred work. We can check
    // this by checking if the root render lanes contain any "update" lanes, i.e.
    // lanes that are only assigned to updates, like setState.
    const rootRenderLanes = getWorkInProgressRootRenderLanes();
    return !includesSomeLane(rootRenderLanes, UpdateLanes);
}
function mountDeferredValueImpl(hook: Hook, value: unknown, initialValue?: unknown): unknown {
    if (
    // When `initialValue` is provided, we defer the initial render even if the
    // current render is not synchronous.
    initialValue !== undefined &&
        // However, to avoid waterfalls, we do not defer if this render
        // was itself spawned by an earlier useDeferredValue. Check if DeferredLane
        // is part of the render lanes.
        !isRenderingDeferredWork()) {
        // Render with the initial value
        hook.memoizedState = initialValue;
        // Schedule a deferred render to switch to the final value.
        const deferredLane = requestDeferredLane();
        currentlyRenderingFiber!.lanes = mergeLanes(currentlyRenderingFiber!.lanes, deferredLane);
        markSkippedUpdateLanes(deferredLane);
        return initialValue;
    }
    else {
        hook.memoizedState = value;
        return value;
    }
}
function updateDeferredValueImpl(hook: Hook, prevValue: unknown, value: unknown, initialValue?: unknown): unknown {
    if (is(value, prevValue)) {
        // The incoming value is referentially identical to the currently rendered
        // value, so we can bail out quickly.
        return value;
    }
    else {
        // Received a new value that's different from the current value.
        // Check if we're inside a hidden tree
        if (isCurrentTreeHidden()) {
            // Revealing a prerendered tree is considered the same as mounting new
            // one, so we reuse the "mount" path in this case.
            const resultValue = mountDeferredValueImpl(hook, value, initialValue);
            // Unlike during an actual mount, we need to mark this as an update if
            // the value changed.
            if (!is(resultValue, prevValue)) {
                markWorkInProgressReceivedUpdate();
            }
            return resultValue;
        }
        const shouldDeferValue = !includesOnlyNonUrgentLanes(renderLanes) && !isRenderingDeferredWork();
        if (shouldDeferValue) {
            // This is an urgent update. Since the value has changed, keep using the
            // previous value and spawn a deferred render to update it later.
            // Schedule a deferred render
            const deferredLane = requestDeferredLane();
            currentlyRenderingFiber!.lanes = mergeLanes(currentlyRenderingFiber!.lanes, deferredLane);
            markSkippedUpdateLanes(deferredLane);
            // Reuse the previous value. We do not need to mark this as an update,
            // because we did not render a new value.
            return prevValue;
        }
        else {
            // This is not an urgent update, so we can use the latest value regardless
            // of what it is. No need to defer it.
            // Mark this as an update to prevent the fiber from bailing out.
            markWorkInProgressReceivedUpdate();
            hook.memoizedState = value;
            return value;
        }
    }
}
function startTransition(fiber: Fiber, queue: UpdateQueue<unknown | Thenable<unknown>, BasicStateAction<unknown | Thenable<unknown>>>, pendingState: unknown, finishedState: unknown, callback: () => unknown, options?: StartTransitionOptions): void {
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(higherEventPriority(previousPriority, ContinuousEventPriority));
    const prevTransition = ReactSharedInternals.T;
    const currentTransition: Transition = { types: undefined }; // React's ({}): `types` reads undefined
    ;
    ;
    ;
    ;
    // We don't really need to use an optimistic update here, because we
    // schedule a second "revert" update below (which we use to suspend the
    // transition until the async action scope has finished). But we'll use an
    // optimistic update anyway to make it less likely the behavior accidentally
    // diverges; for example, both an optimistic update and this one should
    // share the same lane.
    ReactSharedInternals.T = currentTransition;
    dispatchOptimisticSetState(fiber, false, queue, pendingState);
    try {
        const returnValue = callback();
        const onStartTransitionFinish = ReactSharedInternals.S;
        if (onStartTransitionFinish !== null) {
            onStartTransitionFinish(currentTransition, returnValue);
        }
        // Check if we're inside an async action scope. If so, we'll entangle
        // this new action with the existing scope.
        //
        // If we're not already inside an async action scope, and this action is
        // async, then we'll create a new async scope.
        //
        // In the async case, the resulting render will suspend until the async
        // action scope has finished.
        if (returnValue !== null &&
            typeof returnValue === 'object' &&
            typeof readProperty(returnValue as object, 'then') === 'function') {
            const thenable = (returnValue as Thenable<unknown>);
            ;
            // Create a thenable that resolves to `finishedState` once the async
            // action has completed.
            const thenableForFinishedState = chainThenableValue(thenable, finishedState);
            dispatchSetStateInternal(fiber, queue, thenableForFinishedState, requestUpdateLane(fiber));
        }
        else {
            dispatchSetStateInternal(fiber, queue, finishedState, requestUpdateLane(fiber));
        }
    }
    catch (error: unknown) {
        // This is a trick to get the `useTransition` hook to rethrow the error.
        // When it unwraps the thenable with the `use` algorithm, the error
        // will be thrown.
        const rejectedThenable: RejectedThenable<unknown> = {
            then() { },
            status: 'rejected',
            reason: error,
        };
        dispatchSetStateInternal(fiber, queue, rejectedThenable, requestUpdateLane(fiber));
    }
    finally {
        setCurrentUpdatePriority(previousPriority);
        if (prevTransition !== null && currentTransition.types !== null) {
            ;
            prevTransition.types = currentTransition.types;
        }
        ReactSharedInternals.T = prevTransition;
        ;
    }
}
const noop = () => { };
// React's generic <F> is always FormData here (the form action event plugin is the only caller).
export function startHostTransition(formFiber: Fiber, pendingState: TransitionStatus, action: ((formData: FormData) => unknown) | null, formData: FormData): void {
    if (formFiber.tag !== HostComponent) {
        throw new Error('Expected the form instance to be a HostComponent. This ' +
            'is a bug in React.');
    }
    const stateHook = ensureFormComponentIsStateful(formFiber);
    const queue: UpdateQueue<Thenable<TransitionStatus> | TransitionStatus, BasicStateAction<Thenable<TransitionStatus> | TransitionStatus>> = stateHook.queue;
    startHostActionTimer(formFiber);
    startTransition(formFiber, queue, pendingState, NoPendingHostTransition, 
    // TODO: `startTransition` both sets the pending state and dispatches
    // the action, if one is provided. Consider refactoring these two
    // concerns to avoid the extra lambda.
    action === null
        ? // No action was provided, but we still call `startTransition` to
            // set the pending form status.
            noop
        : () => {
            // Automatically reset the form when the action completes.
            requestFormReset(formFiber);
            return action(formData);
        });
}
function ensureFormComponentIsStateful(formFiber: Fiber) {
    const existingStateHook: Hook | null = formFiber.memoizedState;
    if (existingStateHook !== null) {
        // This fiber was already upgraded to be stateful.
        return existingStateHook;
    }
    // Upgrade this host component fiber to be stateful. We're going to pretend
    // it was stateful all along so we can reuse most of the implementation
    // for function components and useTransition.
    //
    // Create the state hook used by TransitionAwareHostComponent. This is
    // essentially an inlined version of mountState.
    const newQueue: UpdateQueue<Thenable<TransitionStatus> | TransitionStatus, BasicStateAction<Thenable<TransitionStatus> | TransitionStatus>> = {
        pending: null,
        lanes: NoLanes,
        // We're going to cheat and intentionally not create a bound dispatch
        // method, because we can call it directly in startTransition.
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: NoPendingHostTransition,
    };
    const stateHook: Hook = {
        memoizedState: NoPendingHostTransition,
        baseState: NoPendingHostTransition,
        baseQueue: null,
        queue: newQueue,
        next: null,
    };
    // We use another state hook to track whether the form needs to be reset.
    // The state is an empty object. To trigger a reset, we update the state
    // to a new object. Then during rendering, we detect that the state has
    // changed and schedule a commit effect.
    const initialResetState: Record<string, any> = {};
    const newResetStateQueue: UpdateQueue<Record<any, any>, Record<any, any>> = {
        pending: null,
        lanes: NoLanes,
        // We're going to cheat and intentionally not create a bound dispatch
        // method, because we can call it directly in startTransition.
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: initialResetState,
    };
    const resetStateHook: Hook = {
        memoizedState: initialResetState,
        baseState: initialResetState,
        baseQueue: null,
        queue: newResetStateQueue,
        next: null,
    };
    stateHook.next = resetStateHook;
    // Add the hook list to both fiber alternates. The idea is that the fiber
    // had this hook all along.
    formFiber.memoizedState = stateHook;
    const alternate = formFiber.alternate;
    if (alternate !== null) {
        alternate.memoizedState = stateHook;
    }
    return stateHook;
}
export function requestFormReset(formFiber: Fiber) {
    const transition = requestCurrentTransition();
    if (transition === null) {
        ;
    }
    else
        ;
    let stateHook: Hook = ensureFormComponentIsStateful(formFiber);
    const newResetState: Record<string, any> = {};
    if (stateHook.next === null) {
        // Hack alert. If formFiber is the workInProgress Fiber then
        // we might get a broken intermediate state. Try the alternate
        // instead.
        // TODO: We should really stash the Queue somewhere stateful
        // just like how setState binds the Queue.
        stateHook = (formFiber.alternate!).memoizedState;
    }
    const resetStateHook: Hook = (stateHook.next!);
    const resetStateQueue = resetStateHook.queue;
    dispatchSetStateInternal(formFiber, resetStateQueue, newResetState, requestUpdateLane(formFiber));
}
function mountTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void
] {
    const stateHook = mountStateImpl((false as Thenable<boolean> | boolean));
    // The `start` method never changes.
    const start = startTransition.bind(null, currentlyRenderingFiber!, stateHook.queue, true, false);
    const hook = mountWorkInProgressHook();
    hook.memoizedState = start;
    return [false, start];
}
function updateTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void
] {
    const [booleanOrThenable] = updateState(false);
    const hook = updateWorkInProgressHook();
    const start = hook.memoizedState;
    const isPending = typeof booleanOrThenable === 'boolean'
        ? booleanOrThenable
        : // This will suspend until the async action scope has finished.
            (useThenable(booleanOrThenable as Thenable<unknown>) as boolean);
    return [isPending, start];
}
function rerenderTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void
] {
    const [booleanOrThenable] = rerenderState(false);
    const hook = updateWorkInProgressHook();
    const start = hook.memoizedState;
    const isPending = typeof booleanOrThenable === 'boolean'
        ? booleanOrThenable
        : // This will suspend until the async action scope has finished.
            (useThenable(booleanOrThenable as Thenable<unknown>) as boolean);
    return [isPending, start];
}
function useHostTransitionStatus(): TransitionStatus {
    return readContext(HostTransitionContext);
}
function mountId(): string {
    const hook = mountWorkInProgressHook();
    const root = (getWorkInProgressRoot() as FiberRoot);
    // TODO: In Fizz, id generation is specific to each server config. Maybe we
    // should do this in Fiber, too? Deferring this decision for now because
    // there's no other place to store the prefix except for an internal field on
    // the public createRoot object, which the fiber tree does not currently have
    // a reference to.
    const identifierPrefix = root.identifierPrefix;
    let id;
    if (getIsHydrating()) {
        const treeId = getTreeId();
        // Use a captial R prefix for server-generated ids.
        id = '_' + identifierPrefix + 'R_' + treeId;
        // Unless this is the first id at this level, append a number at the end
        // that represents the position of this useId hook among all the useId
        // hooks for this fiber.
        const localId = localIdCounter++;
        if (localId > 0) {
            id += 'H' + localId.toString(32);
        }
        id += '_';
    }
    else {
        // Use a lowercase r prefix for client-generated ids.
        const globalClientId = globalClientIdCounter++;
        id = '_' + identifierPrefix + 'r_' + globalClientId.toString(32) + '_';
    }
    hook.memoizedState = id;
    return id;
}
function updateId(): string {
    const hook = updateWorkInProgressHook();
    const id: string = hook.memoizedState;
    return id;
}
function mountRefresh(): any {
    const hook = mountWorkInProgressHook();
    const refresh = (hook.memoizedState = refreshCache.bind(null, currentlyRenderingFiber!));
    return refresh;
}
function updateRefresh(): any {
    const hook = updateWorkInProgressHook();
    return hook.memoizedState;
}
function refreshCache(fiber: Fiber, seedKey: (() => unknown) | null | undefined, seedValue: unknown): void {
    // TODO: Does Cache work in legacy mode? Should decide and write a test.
    // TODO: Consider warning if the refresh is at discrete priority, or if we
    // otherwise suspect that it wasn't batched properly.
    let provider = fiber.return;
    while (provider !== null) {
        switch (provider.tag) {
            case CacheComponent:
            case HostRoot: {
                // Schedule an update on the cache boundary to trigger a refresh.
                const lane = requestUpdateLane(provider);
                const refreshUpdate = createLegacyQueueUpdate(lane);
                const root = enqueueLegacyQueueUpdate(provider, refreshUpdate, lane);
                if (root !== null) {
                    startUpdateTimerByLane(lane, 'refresh()', fiber);
                    scheduleUpdateOnFiber(root, provider, lane);
                    entangleLegacyQueueTransitions(root, provider, lane);
                }
                // TODO: If a refresh never commits, the new cache created here must be
                // released. A simple case is start refreshing a cache boundary, but then
                // unmount that boundary before the refresh completes.
                const seededCache = createCache();
                if (seedKey !== null && seedKey !== undefined && root !== null) {
                    {
                        ;
                    }
                }
                const payload = {
                    cache: seededCache,
                } as const;
                refreshUpdate.payload = payload;
                return;
            }
        }
        provider = provider.return;
    }
    // TODO: Warn if unmounted?
}
function dispatchReducerAction(fiber: Fiber, queue: UpdateQueue<unknown, unknown>, action: unknown): void {
    ;
    const lane = requestUpdateLane(fiber);
    const update: Update<unknown, unknown> = {
        lane,
        revertLane: NoLane,
        gesture: null,
        action,
        hasEagerState: false,
        eagerState: null,
        next: null,
    };
    if (isRenderPhaseUpdate(fiber)) {
        enqueueRenderPhaseUpdate(queue, update);
    }
    else {
        const root = enqueueConcurrentHookUpdate(fiber, queue as UpdateQueue<unknown, unknown>, update as Update<unknown, unknown>, lane); // erased dispatcher: the unknown instantiation
        if (root !== null) {
            startUpdateTimerByLane(lane, 'dispatch()', fiber);
            scheduleUpdateOnFiber(root, fiber, lane);
            entangleTransitionUpdate(root, queue, lane);
        }
    }
    markUpdateInDevTools(fiber, lane, action);
}
function dispatchSetState(fiber: Fiber, queue: UpdateQueue<unknown, unknown>, action: unknown): void {
    ;
    const lane = requestUpdateLane(fiber);
    const didScheduleUpdate = dispatchSetStateInternal(fiber, queue, action, lane);
    if (didScheduleUpdate) {
        startUpdateTimerByLane(lane, 'setState()', fiber);
    }
    markUpdateInDevTools(fiber, lane, action);
}
function dispatchSetStateInternal(fiber: Fiber, queue: UpdateQueue<unknown, unknown>, action: unknown, lane: Lane): boolean {
    const update: Update<unknown, unknown> = {
        lane,
        revertLane: NoLane,
        gesture: null,
        action,
        hasEagerState: false,
        eagerState: null,
        next: null,
    };
    if (isRenderPhaseUpdate(fiber)) {
        enqueueRenderPhaseUpdate(queue, update);
    }
    else {
        const alternate = fiber.alternate;
        if (fiber.lanes === NoLanes &&
            (alternate === null || alternate.lanes === NoLanes)) {
            // The queue is currently empty, which means we can eagerly compute the
            // next state before entering the render phase. If the new state is the
            // same as the current state, we may be able to bail out entirely.
            const lastRenderedReducer = queue.lastRenderedReducer;
            if (lastRenderedReducer !== null) {
                let prevDispatcher = null;
                ;
                try {
                    // The state itself may be null; it is the last rendered value.
                    const currentState: unknown = (queue.lastRenderedState as unknown);
                    const eagerState = lastRenderedReducer(currentState, action);
                    // Stash the eagerly computed state, and the reducer used to compute
                    // it, on the update object. If the reducer hasn't changed by the
                    // time we enter the render phase, then the eager state can be used
                    // without calling the reducer again.
                    update.hasEagerState = true;
                    update.eagerState = eagerState;
                    if (is(eagerState, currentState)) {
                        // Fast path. We can bail out without scheduling React to re-render.
                        // It's still possible that we'll need to rebase this update later,
                        // if the component re-renders for a different reason and by that
                        // time the reducer has changed.
                        // TODO: Do we still need to entangle transitions in this case?
                        enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue as UpdateQueue<unknown, unknown>, update as Update<unknown, unknown>);
                        return false;
                    }
                }
                catch (error: unknown) {
                    // Suppress the error. It will throw again in the render phase.
                }
                finally {
                    ;
                }
            }
        }
        const root = enqueueConcurrentHookUpdate(fiber, queue as UpdateQueue<unknown, unknown>, update as Update<unknown, unknown>, lane); // erased dispatcher: the unknown instantiation
        if (root !== null) {
            scheduleUpdateOnFiber(root, fiber, lane);
            entangleTransitionUpdate(root, queue, lane);
            return true;
        }
    }
    return false;
}
function dispatchOptimisticSetState(fiber: Fiber, throwIfDuringRender: boolean, queue: UpdateQueue<unknown, unknown>, action: unknown): void {
    const transition = requestCurrentTransition();
    ;
    // For regular Transitions an optimistic update commits synchronously.
    // For gesture Transitions an optimistic update commits on the GestureLane.
    const lane = SyncLane;
    const update: Update<unknown, unknown> = {
        lane: lane,
        // After committing, the optimistic update is "reverted" using the same
        // lane as the transition it's associated with.
        revertLane: requestTransitionLane(transition),
        gesture: null,
        action,
        hasEagerState: false,
        eagerState: null,
        next: null,
    };
    if (isRenderPhaseUpdate(fiber)) {
        // When calling startTransition during render, this warns instead of
        // throwing because throwing would be a breaking change. setOptimisticState
        // is a new API so it's OK to throw.
        if (throwIfDuringRender) {
            throw new Error('Cannot update optimistic state while rendering.');
        }
        else {
            ;
        }
    }
    else {
        const root = enqueueConcurrentHookUpdate(fiber, queue as UpdateQueue<unknown, unknown>, update as Update<unknown, unknown>, lane); // erased dispatcher: the unknown instantiation
        if (root !== null) {
            // NOTE: The optimistic update implementation assumes that the transition
            // will never be attempted before the optimistic update. This currently
            // holds because the optimistic update is always synchronous. If we ever
            // change that, we'll need to account for this.
            startUpdateTimerByLane(lane, 'setOptimistic()', fiber);
            scheduleUpdateOnFiber(root, fiber, lane);
            ;
        }
    }
    markUpdateInDevTools(fiber, lane, action);
}
function isRenderPhaseUpdate(fiber: Fiber): boolean {
    const alternate = fiber.alternate;
    return (fiber === currentlyRenderingFiber ||
        (alternate !== null && alternate === currentlyRenderingFiber));
}
function enqueueRenderPhaseUpdate(queue: UpdateQueue<unknown, unknown>, update: Update<unknown, unknown>): void {
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate =
        true;
    const pending = queue.pending;
    if (pending === null) {
        // This is the first update. Create a circular list.
        update.next = update;
    }
    else {
        update.next = pending.next;
        pending.next = update;
    }
    queue.pending = update;
}
// TODO: Move to ReactFiberConcurrentUpdates?
function entangleTransitionUpdate(root: FiberRoot, queue: UpdateQueue<unknown, unknown>, lane: Lane): void {
    if (isTransitionLane(lane)) {
        let queueLanes = queue.lanes;
        // If any entangled lanes are no longer pending on the root, then they
        // must have finished. We can remove them from the shared queue, which
        // represents a superset of the actually pending lanes. In some cases we
        // may entangle more than we need to, but that's OK. In fact it's worse if
        // we *don't* entangle when we should.
        queueLanes = intersectLanes(queueLanes, root.pendingLanes);
        // Entangle the new transition lane with the other transition lanes.
        const newQueueLanes = mergeLanes(queueLanes, lane);
        queue.lanes = newQueueLanes;
        // Even if queue.lanes already include lane, we don't know for certain if
        // the lane finished since the last time we entangled it. So we need to
        // entangle it again, just to be sure.
        markRootEntangled(root, newQueueLanes);
    }
}
function markUpdateInDevTools(fiber: Fiber, lane: Lane, action: unknown): void {
    ;
}
export const ContextOnlyDispatcher: Dispatcher = {
    readContext: readContext<unknown>, // the dispatcher is erased: one instantiation, same function
    use: use, // erased dispatcher: one instantiation
    useCallback: throwInvalidHookError,
    useContext: throwInvalidHookError,
    useEffect: throwInvalidHookError,
    useImperativeHandle: throwInvalidHookError,
    useLayoutEffect: throwInvalidHookError,
    useInsertionEffect: throwInvalidHookError,
    useMemo: throwInvalidHookError,
    useReducer: throwInvalidHookError,
    useRef: throwInvalidHookError,
    useState: throwInvalidHookError,
    useDebugValue: throwInvalidHookError,
    useDeferredValue: throwInvalidHookError,
    useTransition: throwInvalidHookError,
    useSyncExternalStore: throwInvalidHookError,
    useId: throwInvalidHookError,
    useHostTransitionStatus: throwInvalidHookError,
    useFormState: throwInvalidHookError,
    useActionState: throwInvalidHookError,
    useOptimistic: throwInvalidHookError,
    useMemoCache: throwInvalidHookError,
    useCacheRefresh: throwInvalidHookError,
};
{
    (ContextOnlyDispatcher as Dispatcher).useEffectEvent = throwInvalidHookError;
}
const HooksDispatcherOnMount: Dispatcher = {
    readContext: readContext<unknown>, // the dispatcher is erased: one instantiation, same function
    use: use, // erased dispatcher: one instantiation
    useCallback: mountCallback,
    useContext: readContext,
    useEffect: mountEffect,
    useImperativeHandle: mountImperativeHandle,
    useLayoutEffect: mountLayoutEffect,
    useInsertionEffect: mountInsertionEffect,
    useMemo: mountMemo,
    useReducer: mountReducer,
    useRef: mountRef,
    useState: mountState,
    useDebugValue: mountDebugValue,
    useDeferredValue: mountDeferredValue,
    useTransition: mountTransition,
    useSyncExternalStore: mountSyncExternalStore,
    useId: mountId,
    useHostTransitionStatus: useHostTransitionStatus,
    useFormState: mountActionState,
    useActionState: mountActionState,
    useOptimistic: mountOptimistic,
    useMemoCache,
    useCacheRefresh: mountRefresh,
};
{
    (HooksDispatcherOnMount as Dispatcher).useEffectEvent = mountEvent;
}
const HooksDispatcherOnUpdate: Dispatcher = {
    readContext: readContext<unknown>, // the dispatcher is erased: one instantiation, same function
    use: use, // erased dispatcher: one instantiation
    useCallback: updateCallback,
    useContext: readContext,
    useEffect: updateEffect,
    useImperativeHandle: updateImperativeHandle,
    useInsertionEffect: updateInsertionEffect,
    useLayoutEffect: updateLayoutEffect,
    useMemo: updateMemo,
    useReducer: updateReducer,
    useRef: updateRef,
    useState: updateState,
    useDebugValue: mountDebugValue, // React's updateDebugValue is this same function
    useDeferredValue: updateDeferredValue,
    useTransition: updateTransition,
    useSyncExternalStore: updateSyncExternalStore,
    useId: updateId,
    useHostTransitionStatus: useHostTransitionStatus,
    useFormState: updateActionState,
    useActionState: updateActionState,
    useOptimistic: updateOptimistic,
    useMemoCache,
    useCacheRefresh: updateRefresh,
};
{
    (HooksDispatcherOnUpdate as Dispatcher).useEffectEvent = updateEvent;
}
const HooksDispatcherOnRerender: Dispatcher = {
    readContext: readContext<unknown>, // the dispatcher is erased: one instantiation, same function
    use: use, // erased dispatcher: one instantiation
    useCallback: updateCallback,
    useContext: readContext,
    useEffect: updateEffect,
    useImperativeHandle: updateImperativeHandle,
    useInsertionEffect: updateInsertionEffect,
    useLayoutEffect: updateLayoutEffect,
    useMemo: updateMemo,
    useReducer: rerenderReducer,
    useRef: updateRef,
    useState: rerenderState,
    useDebugValue: mountDebugValue, // React's updateDebugValue is this same function
    useDeferredValue: rerenderDeferredValue,
    useTransition: rerenderTransition,
    useSyncExternalStore: updateSyncExternalStore,
    useId: updateId,
    useHostTransitionStatus: useHostTransitionStatus,
    useFormState: rerenderActionState,
    useActionState: rerenderActionState,
    useOptimistic: rerenderOptimistic,
    useMemoCache,
    useCacheRefresh: updateRefresh,
};
{
    (HooksDispatcherOnRerender as Dispatcher).useEffectEvent = updateEvent;
}
;
