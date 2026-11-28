/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { resolveClassComponentProps } from './ReactFiberClassComponent';
import type { UpdateQueue } from './ReactFiberClassUpdateQueue';
import { commitCallbacks,commitHiddenCallbacks } from './ReactFiberClassUpdateQueue';
import { getPublicInstance } from './ReactFiberConfig';
import type { FunctionComponentUpdateQueue } from './ReactFiberHooks';
import { captureCommitPhaseError } from './ReactFiberWorkLoop';
import type { HookFlags } from './ReactHookEffectTags';
import type { Fiber } from './ReactInternalTypes';
import { recordEffectDuration,startEffectTimer } from './ReactProfilerTimer';
import { ClassComponent,Fragment,HostComponent,HostHoistable,HostSingleton,ViewTransitionComponent } from './ReactWorkTags';
function shouldProfile(current: Fiber): boolean {
    return (false);
}
export function commitHookLayoutEffects(finishedWork: Fiber, hookFlags: HookFlags) {
    // At this point layout effects have already been destroyed (during mutation phase).
    // This is done to prevent sibling component effects from interfering with each other,
    // e.g. a destroy function in one component should never override a ref set
    // by a create function in another component during the same commit.
    if (shouldProfile(finishedWork)) {
        startEffectTimer();
        commitHookEffectListMount(hookFlags, finishedWork);
        recordEffectDuration(finishedWork);
    }
    else {
        commitHookEffectListMount(hookFlags, finishedWork);
    }
}
export function commitHookLayoutUnmountEffects(finishedWork: Fiber, nearestMountedAncestor: null | Fiber, hookFlags: HookFlags) {
    // Layout effects are destroyed during the mutation phase so that all
    // destroy functions for all fibers are called before any create functions.
    // This prevents sibling component effects from interfering with each other,
    // e.g. a destroy function in one component should never override a ref set
    // by a create function in another component during the same commit.
    if (shouldProfile(finishedWork)) {
        startEffectTimer();
        commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
        recordEffectDuration(finishedWork);
    }
    else {
        commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
    }
}
export function commitHookEffectListMount(flags: HookFlags, finishedWork: Fiber) {
    try {
        const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue as FunctionComponentUpdateQueue | null);
        const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
        if (lastEffect !== null) {
            const firstEffect = lastEffect.next;
            let effect = firstEffect;
            do {
                if ((effect!.tag & flags) === flags) {
                    ;
                    // Mount
                    let destroy;
                    {
                        const create = effect!.create;
                        const inst = effect!.inst;
                        destroy = create();
                        inst.destroy = destroy;
                    }
                    ;
                    ;
                }
                effect = effect!.next;
            } while (effect !== firstEffect);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHookEffectListUnmount(flags: HookFlags, finishedWork: Fiber, nearestMountedAncestor: Fiber | null) {
    try {
        const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue as FunctionComponentUpdateQueue | null);
        const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
        if (lastEffect !== null) {
            const firstEffect = lastEffect.next;
            let effect = firstEffect;
            do {
                if ((effect!.tag & flags) === flags) {
                    // Unmount
                    const inst = effect!.inst;
                    const destroy = inst.destroy;
                    if (destroy !== undefined) {
                        inst.destroy = undefined;
                        ;
                        ;
                        safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);
                        ;
                        ;
                    }
                }
                effect = effect!.next;
            } while (effect !== firstEffect);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHookPassiveMountEffects(finishedWork: Fiber, hookFlags: HookFlags) {
    if (shouldProfile(finishedWork)) {
        startEffectTimer();
        commitHookEffectListMount(hookFlags, finishedWork);
        recordEffectDuration(finishedWork);
    }
    else {
        commitHookEffectListMount(hookFlags, finishedWork);
    }
}
export function commitHookPassiveUnmountEffects(finishedWork: Fiber, nearestMountedAncestor: null | Fiber, hookFlags: HookFlags) {
    if (shouldProfile(finishedWork)) {
        startEffectTimer();
        commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
        recordEffectDuration(finishedWork);
    }
    else {
        commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
    }
}
export function commitClassLayoutLifecycles(finishedWork: Fiber, current: Fiber | null) {
    const instance = finishedWork.stateNode;
    if (current === null) {
        ;
        if (shouldProfile(finishedWork)) {
            startEffectTimer();
            {
                try {
                    instance.componentDidMount();
                }
                catch (error: unknown) {
                    captureCommitPhaseError(finishedWork, finishedWork.return, error);
                }
            }
            recordEffectDuration(finishedWork);
        }
        else {
            {
                try {
                    instance.componentDidMount();
                }
                catch (error: unknown) {
                    captureCommitPhaseError(finishedWork, finishedWork.return, error);
                }
            }
        }
    }
    else {
        const prevProps = resolveClassComponentProps(finishedWork.type, current.memoizedProps);
        const prevState = current.memoizedState;
        ;
        if (shouldProfile(finishedWork)) {
            startEffectTimer();
            {
                try {
                    instance.componentDidUpdate(prevProps, prevState, instance.__reactInternalSnapshotBeforeUpdate);
                }
                catch (error: unknown) {
                    captureCommitPhaseError(finishedWork, finishedWork.return, error);
                }
            }
            recordEffectDuration(finishedWork);
        }
        else {
            {
                try {
                    instance.componentDidUpdate(prevProps, prevState, instance.__reactInternalSnapshotBeforeUpdate);
                }
                catch (error: unknown) {
                    captureCommitPhaseError(finishedWork, finishedWork.return, error);
                }
            }
        }
    }
}
export function commitClassDidMount(finishedWork: Fiber) {
    // TODO: Check for LayoutStatic flag
    const instance = finishedWork.stateNode;
    if (typeof instance.componentDidMount === 'function') {
        {
            try {
                instance.componentDidMount();
            }
            catch (error: unknown) {
                captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
        }
    }
}
export function commitClassCallbacks(finishedWork: Fiber) {
    // TODO: I think this is now always non-null by the time it reaches the
    // commit phase. Consider removing the type check.
    const updateQueue: UpdateQueue<unknown> | null = (finishedWork.updateQueue as UpdateQueue<unknown> | null);
    if (updateQueue !== null) {
        const instance = finishedWork.stateNode;
        ;
        // We could update instance props and state here,
        // but instead we rely on them being set during last render.
        // TODO: revisit this when we implement resuming.
        try {
            {
                commitCallbacks(updateQueue, instance);
            }
        }
        catch (error: unknown) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
    }
}
export function commitClassHiddenCallbacks(finishedWork: Fiber) {
    // Commit any callbacks that would have fired while the component
    // was hidden.
    const updateQueue: UpdateQueue<unknown> | null = (finishedWork.updateQueue as UpdateQueue<unknown> | null);
    if (updateQueue !== null) {
        const instance = finishedWork.stateNode;
        try {
            {
                commitHiddenCallbacks(updateQueue, instance);
            }
        }
        catch (error: unknown) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
    }
}
export function commitRootCallbacks(finishedWork: Fiber) {
    // TODO: I think this is now always non-null by the time it reaches the
    // commit phase. Consider removing the type check.
    const updateQueue: UpdateQueue<unknown> | null = (finishedWork.updateQueue as UpdateQueue<unknown> | null);
    if (updateQueue !== null) {
        let instance = null;
        if (finishedWork.child !== null) {
            switch (finishedWork.child.tag) {
                case HostSingleton:
                case HostComponent:
                    instance = getPublicInstance(finishedWork.child.stateNode);
                    break;
                case ClassComponent:
                    instance = finishedWork.child.stateNode;
                    break;
            }
        }
        try {
            {
                commitCallbacks(updateQueue, instance);
            }
        }
        catch (error: unknown) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
    }
}
;
function callGetSnapshotBeforeUpdates(instance: any, prevProps: unknown, prevState: unknown) {
    return instance.getSnapshotBeforeUpdate(prevProps, prevState);
}
export function commitClassSnapshot(finishedWork: Fiber, current: Fiber) {
    const prevProps = current.memoizedProps;
    const prevState = current.memoizedState;
    const instance = finishedWork.stateNode;
    ;
    try {
        const resolvedPrevProps = resolveClassComponentProps(finishedWork.type, prevProps);
        let snapshot;
        {
            snapshot = callGetSnapshotBeforeUpdates(instance, resolvedPrevProps, prevState);
        }
        instance.__reactInternalSnapshotBeforeUpdate = snapshot;
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
// Capture errors so they don't interrupt unmounting.
export function safelyCallComponentWillUnmount(current: Fiber, nearestMountedAncestor: Fiber | null, instance: any) {
    instance.props = resolveClassComponentProps(current.type, current.memoizedProps);
    instance.state = current.memoizedState;
    if (shouldProfile(current)) {
        startEffectTimer();
        {
            try {
                instance.componentWillUnmount();
            }
            catch (error: unknown) {
                captureCommitPhaseError(current, nearestMountedAncestor, error);
            }
        }
        recordEffectDuration(current);
    }
    else {
        {
            try {
                instance.componentWillUnmount();
            }
            catch (error: unknown) {
                captureCommitPhaseError(current, nearestMountedAncestor, error);
            }
        }
    }
}
function commitAttachRef(finishedWork: Fiber) {
    const ref = finishedWork.ref;
    if (ref !== null) {
        let instanceToUse;
        switch (finishedWork.tag) {
            case HostHoistable:
            case HostSingleton:
            case HostComponent:
                instanceToUse = getPublicInstance(finishedWork.stateNode);
                break;
            case ViewTransitionComponent: {
                ;
                instanceToUse = finishedWork.stateNode;
                break;
            }
            case Fragment: ;
            // Fallthrough
            default:
                instanceToUse = finishedWork.stateNode;
        }
        if (typeof ref === 'function') {
            if (shouldProfile(finishedWork)) {
                try {
                    startEffectTimer();
                    finishedWork.refCleanup = ref(instanceToUse);
                }
                finally {
                    recordEffectDuration(finishedWork);
                }
            }
            else {
                finishedWork.refCleanup = ref(instanceToUse);
            }
        }
        else {
            ;
            ref.current = instanceToUse;
        }
    }
}
// Capture errors so they don't interrupt mounting.
export function safelyAttachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
    try {
        {
            commitAttachRef(current);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
}
export function safelyDetachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
    const ref = current.ref;
    const refCleanup = current.refCleanup;
    if (ref !== null) {
        if (typeof refCleanup === 'function') {
            try {
                if (shouldProfile(current)) {
                    try {
                        startEffectTimer();
                        {
                            refCleanup();
                        }
                    }
                    finally {
                        recordEffectDuration(current);
                    }
                }
                else {
                    {
                        refCleanup();
                    }
                }
            }
            catch (error: unknown) {
                captureCommitPhaseError(current, nearestMountedAncestor, error);
            }
            finally {
                // `refCleanup` has been called. Nullify all references to it to prevent double invocation.
                current.refCleanup = null;
                const finishedWork = current.alternate;
                if (finishedWork != null) {
                    finishedWork.refCleanup = null;
                }
            }
        }
        else if (typeof ref === 'function') {
            try {
                if (shouldProfile(current)) {
                    try {
                        startEffectTimer();
                        {
                            ref(null);
                        }
                    }
                    finally {
                        recordEffectDuration(current);
                    }
                }
                else {
                    {
                        ref(null);
                    }
                }
            }
            catch (error: unknown) {
                captureCommitPhaseError(current, nearestMountedAncestor, error);
            }
        }
        else {
            ref.current = null;
        }
    }
}
function safelyCallDestroy(current: Fiber, nearestMountedAncestor: Fiber | null, destroy: (() => void) | ((arg1: Record<any, any>) => void), resource?: Record<any, any> | null) {
    const destroy_: () => void = resource == null ? (destroy as () => void) : (destroy as (arg1: Record<any, any>) => void).bind(null, resource);
    {
        try {
            destroy_();
        }
        catch (error: unknown) {
            captureCommitPhaseError(current, nearestMountedAncestor, error);
        }
    }
}
export function commitProfilerUpdate(finishedWork: Fiber, current: Fiber | null, commitStartTime: number, effectDuration: number) {
    ;
}
function commitProfilerPostCommitImpl(finishedWork: Fiber, current: Fiber | null, commitStartTime: number, passiveEffectDuration: number): void {
    const { id, onPostCommit } = finishedWork.memoizedProps;
    let phase = current === null ? 'mount' : 'update';
    ;
    if (typeof onPostCommit === 'function') {
        onPostCommit(id, phase, passiveEffectDuration, commitStartTime);
    }
}
export function commitProfilerPostCommit(finishedWork: Fiber, current: Fiber | null, commitStartTime: number, passiveEffectDuration: number) {
    try {
        {
            commitProfilerPostCommitImpl(finishedWork, current, commitStartTime, passiveEffectDuration);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
