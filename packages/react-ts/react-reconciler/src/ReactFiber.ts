/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ReactElement } from 'shared/ReactElementType';
import { REACT_ACTIVITY_TYPE,REACT_CONSUMER_TYPE,REACT_CONTEXT_TYPE,REACT_FORWARD_REF_TYPE,REACT_FRAGMENT_TYPE,REACT_LAZY_TYPE,REACT_LEGACY_HIDDEN_TYPE,REACT_MEMO_TYPE,REACT_PROFILER_TYPE,REACT_SCOPE_TYPE,REACT_STRICT_MODE_TYPE,REACT_SUSPENSE_LIST_TYPE,REACT_SUSPENSE_TYPE,REACT_TRACING_MARKER_TYPE,REACT_VIEW_TRANSITION_TYPE } from 'shared/ReactSymbols';
import type { ActivityProps,ReactFragment,ReactPortal } from 'shared/ReactTypes';
import type { ReactComponentInfo } from '../../shared/ReactTypes';
import type { ActivityInstance,SuspenseInstance } from './ReactFiberConfig';
import { isHostHoistableType,isHostSingletonType,supportsResources,supportsSingletons } from './ReactFiberConfig';
import { NoFlags,Placement,StaticMask } from './ReactFiberFlags';
import { getHostContext } from './ReactFiberHostContext';
import type { Lanes } from './ReactFiberLane';
import { NoLanes } from './ReactFiberLane';
import type { OffscreenProps } from './ReactFiberOffscreenComponent';
import type { Fiber } from './ReactInternalTypes';
import type { RootTag } from './ReactRootTags';
import type { TypeOfMode } from './ReactTypeOfMode';
import { ConcurrentMode,NoMode,ProfileMode,StrictEffectsMode,StrictLegacyMode } from './ReactTypeOfMode';
import type { WorkTag } from './ReactWorkTags';
import { ActivityComponent,ClassComponent,ContextConsumer,ContextProvider,DehydratedFragment,ForwardRef,Fragment,FunctionComponent,HostComponent,HostHoistable,HostPortal,HostRoot,HostSingleton,HostText,LazyComponent,MemoComponent,Mode,OffscreenComponent,Profiler,SuspenseComponent,SuspenseListComponent,Throw } from './ReactWorkTags';
export type { Fiber };
;
// React's FiberNode function constructor as a class with the same fields, assigned in the same order.
class FiberNode implements Fiber {
    tag: Fiber['tag'];
    key: Fiber['key'];
    elementType: Fiber['elementType'];
    type: Fiber['type'];
    stateNode: Fiber['stateNode'];
    return: Fiber['return'];
    child: Fiber['child'];
    sibling: Fiber['sibling'];
    index: Fiber['index'];
    ref: Fiber['ref'];
    refCleanup: Fiber['refCleanup'];
    pendingProps: Fiber['pendingProps'];
    memoizedProps: Fiber['memoizedProps'];
    updateQueue: Fiber['updateQueue'];
    memoizedState: Fiber['memoizedState'];
    dependencies: Fiber['dependencies'];
    mode: Fiber['mode'];
    flags: Fiber['flags'];
    subtreeFlags: Fiber['subtreeFlags'];
    deletions: Fiber['deletions'];
    lanes: Fiber['lanes'];
    childLanes: Fiber['childLanes'];
    alternate: Fiber['alternate'];
    constructor(tag: WorkTag, pendingProps: unknown, key: null | string, mode: TypeOfMode) {
        // Instance
        this.tag = tag;
        this.key = key;
        this.elementType = null;
        this.type = null;
        this.stateNode = null;
        // Fiber
        this.return = null;
        this.child = null;
        this.sibling = null;
        this.index = 0;
        this.ref = null;
        this.refCleanup = null;
        this.pendingProps = pendingProps;
        this.memoizedProps = null;
        this.updateQueue = null;
        this.memoizedState = null;
        this.dependencies = null;
        this.mode = mode;
        // Effects
        this.flags = NoFlags;
        this.subtreeFlags = NoFlags;
        this.deletions = null;
        this.lanes = NoLanes;
        this.childLanes = NoLanes;
        this.alternate = null;
        ;
        ;
    }
}
// This is a constructor function, rather than a POJO constructor, still
// please ensure we do the following:
// 1) Nobody should add any instance methods on this. Instance methods can be
//    more difficult to predict when they get optimized and they are almost
//    never inlined properly in static compilers.
// 2) Nobody should rely on `instanceof Fiber` for type testing. We should
//    always know when it is a fiber.
// 3) We might want to experiment with using numeric keys since they are easier
//    to optimize in a non-JIT environment.
// 4) We can easily go from a constructor to a createFiber object literal if that
//    is faster.
// 5) It should be easy to port this to a C struct and keep a C implementation
//    compatible.
function createFiberImplClass(tag: WorkTag, pendingProps: unknown, key: null | string, mode: TypeOfMode): Fiber {
    return new FiberNode(tag, pendingProps, key, mode);
}
const createFiber = createFiberImplClass;
function shouldConstruct(Component: Function) {
    const prototype = Component.prototype;
    return !!(prototype && prototype.isReactComponent);
}
export function isSimpleFunctionComponent(type: any): boolean {
    return (typeof type === 'function' &&
        !shouldConstruct(type) &&
        type.defaultProps === undefined);
}
export function isFunctionClassComponent(type: (...args: Array<any>) => unknown): boolean {
    return shouldConstruct(type);
}
// This is used to create an alternate fiber to do work on.
export function createWorkInProgress(current: Fiber, pendingProps: unknown): Fiber {
    let workInProgress = current.alternate;
    if (workInProgress === null) {
        // We use a double buffering pooling technique because we know that we'll
        // only ever need at most two versions of a tree. We pool the "other" unused
        // node that we're free to reuse. This is lazily created to avoid allocating
        // extra objects for things that are never updated. It also allow us to
        // reclaim the extra memory if needed.
        workInProgress = createFiber(current.tag, pendingProps, current.key, current.mode);
        workInProgress.elementType = current.elementType;
        workInProgress.type = current.type;
        workInProgress.stateNode = current.stateNode;
        ;
        workInProgress.alternate = current;
        current.alternate = workInProgress;
    }
    else {
        workInProgress.pendingProps = pendingProps;
        // Needed because Blocks store data on type.
        workInProgress.type = current.type;
        // We already have an alternate.
        // Reset the effect tag.
        workInProgress.flags = NoFlags;
        // The effects are no longer valid.
        workInProgress.subtreeFlags = NoFlags;
        workInProgress.deletions = null;
        ;
    }
    // Reset all effects except static ones.
    // Static effects are not specific to a render.
    workInProgress.flags = current.flags & StaticMask;
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;
    workInProgress.child = current.child;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;
    // Clone the dependencies object. This is mutated during the render phase, so
    // it cannot be shared with the current fiber.
    const currentDependencies = current.dependencies;
    workInProgress.dependencies =
        currentDependencies === null
            ? null
            :
                {
                    lanes: currentDependencies.lanes,
                    firstContext: currentDependencies.firstContext,
                };
    // These will be overridden during the parent's reconciliation
    workInProgress.sibling = current.sibling;
    workInProgress.index = current.index;
    workInProgress.ref = current.ref;
    workInProgress.refCleanup = current.refCleanup;
    ;
    ;
    return workInProgress;
}
// Used to reuse a Fiber for a second pass.
export function resetWorkInProgress(workInProgress: Fiber, renderLanes: Lanes): Fiber {
    // This resets the Fiber to what createFiber or createWorkInProgress would
    // have set the values to before during the first pass. Ideally this wouldn't
    // be necessary but unfortunately many code paths reads from the workInProgress
    // when they should be reading from current and writing to workInProgress.
    // We assume pendingProps, index, key, ref, return are still untouched to
    // avoid doing another reconciliation.
    // Reset the effect flags but keep any Placement tags, since that's something
    // that child fiber is setting, not the reconciliation.
    workInProgress.flags &= StaticMask | Placement;
    // The effects are no longer valid.
    const current = workInProgress.alternate;
    if (current === null) {
        // Reset to createFiber's initial values.
        workInProgress.childLanes = NoLanes;
        workInProgress.lanes = renderLanes;
        workInProgress.child = null;
        workInProgress.subtreeFlags = NoFlags;
        workInProgress.memoizedProps = null;
        workInProgress.memoizedState = null;
        workInProgress.updateQueue = null;
        workInProgress.dependencies = null;
        workInProgress.stateNode = null;
        ;
    }
    else {
        // Reset to the cloned values that createWorkInProgress would've.
        workInProgress.childLanes = current.childLanes;
        workInProgress.lanes = current.lanes;
        workInProgress.child = current.child;
        workInProgress.subtreeFlags = NoFlags;
        workInProgress.deletions = null;
        workInProgress.memoizedProps = current.memoizedProps;
        workInProgress.memoizedState = current.memoizedState;
        workInProgress.updateQueue = current.updateQueue;
        // Needed because Blocks store data on type.
        workInProgress.type = current.type;
        // Clone the dependencies object. This is mutated during the render phase, so
        // it cannot be shared with the current fiber.
        const currentDependencies = current.dependencies;
        workInProgress.dependencies =
            currentDependencies === null
                ? null
                :
                    {
                        lanes: currentDependencies.lanes,
                        firstContext: currentDependencies.firstContext,
                    };
        ;
    }
    return workInProgress;
}
export function createHostRootFiber(tag: RootTag, isStrictMode: boolean): Fiber {
    let mode: number;
    {
        mode = ConcurrentMode;
        if (isStrictMode === true) {
            mode |= StrictLegacyMode | StrictEffectsMode;
        }
    }
    ;
    return createFiber(HostRoot, null, null, mode);
}
// TODO: Get rid of this helper. Only createFiberFromElement should exist.
export function createFiberFromTypeAndProps(
// React$ElementType
type: any, key: null | string, pendingProps: any, owner: null | ReactComponentInfo | Fiber, mode: TypeOfMode, lanes: Lanes): Fiber {
    let fiberTag: WorkTag = FunctionComponent;
    // The resolved type is set if we know what the final type will be. I.e. it's not lazy.
    let resolvedType = type;
    if (typeof type === 'function') {
        if (shouldConstruct(type)) {
            fiberTag = ClassComponent;
            ;
        }
        else {
            ;
        }
    }
    else if (typeof type === 'string') {
        if (supportsResources && supportsSingletons) {
            const hostContext = getHostContext();
            fiberTag = isHostHoistableType(type, pendingProps, hostContext)
                ? HostHoistable
                : isHostSingletonType(type)
                    ? HostSingleton
                    : HostComponent;
        }
        else if (supportsResources) {
            const hostContext = getHostContext();
            fiberTag = isHostHoistableType(type, pendingProps, hostContext)
                ? HostHoistable
                : HostComponent;
        }
        else if (supportsSingletons) {
            fiberTag = isHostSingletonType(type) ? HostSingleton : HostComponent;
        }
        else {
            fiberTag = HostComponent;
        }
    }
    else {
        getTag: switch (type) {
            case REACT_ACTIVITY_TYPE:
                return createFiberFromActivity(pendingProps, mode, lanes, key);
            case REACT_FRAGMENT_TYPE:
                return createFiberFromFragment(pendingProps.children, mode, lanes, key);
            case REACT_STRICT_MODE_TYPE:
                fiberTag = Mode;
                mode |= StrictLegacyMode;
                {
                    // Strict effects should never run on legacy roots
                    mode |= StrictEffectsMode;
                }
                break;
            case REACT_PROFILER_TYPE:
                return createFiberFromProfiler(pendingProps, mode, lanes, key);
            case REACT_SUSPENSE_TYPE:
                return createFiberFromSuspense(pendingProps, mode, lanes, key);
            case REACT_SUSPENSE_LIST_TYPE:
                return createFiberFromSuspenseList(pendingProps, mode, lanes, key);
            case REACT_LEGACY_HIDDEN_TYPE: ;
            // Fall through
            case REACT_VIEW_TRANSITION_TYPE: ;
            // Fall through
            case REACT_SCOPE_TYPE: ;
            // Fall through
            case REACT_TRACING_MARKER_TYPE: ;
            // Fall through
            default: {
                if (typeof type === 'object' && type !== null) {
                    switch (type.$$typeof) {
                        case REACT_CONTEXT_TYPE:
                            fiberTag = ContextProvider;
                            break getTag;
                        case REACT_CONSUMER_TYPE:
                            fiberTag = ContextConsumer;
                            break getTag;
                        // Fall through
                        case REACT_FORWARD_REF_TYPE:
                            fiberTag = ForwardRef;
                            ;
                            break getTag;
                        case REACT_MEMO_TYPE:
                            fiberTag = MemoComponent;
                            break getTag;
                        case REACT_LAZY_TYPE:
                            fiberTag = LazyComponent;
                            resolvedType = null;
                            break getTag;
                    }
                }
                let info = '';
                let typeString;
                {
                    typeString = type === null ? 'null' : typeof type;
                }
                // The type is invalid but it's conceptually a child that errored and not the
                // current component itself so we create a virtual child that throws in its
                // begin phase. This is the same thing we do in ReactChildFiber if we throw
                // but we do it here so that we can assign the debug owner and stack from the
                // element itself. That way the error stack will point to the JSX callsite.
                fiberTag = Throw;
                pendingProps = new Error('Element type is invalid: expected a string (for built-in ' +
                    'components) or a class/function (for composite components) ' +
                    `but got: ${typeString}.${info}`);
                resolvedType = null;
            }
        }
    }
    const fiber = createFiber(fiberTag, pendingProps, key, mode);
    fiber.elementType = type;
    fiber.type = resolvedType;
    fiber.lanes = lanes;
    ;
    return fiber;
}
export function createFiberFromElement(element: ReactElement, mode: TypeOfMode, lanes: Lanes): Fiber {
    let owner = null;
    ;
    const type = element.type;
    const key = element.key;
    const pendingProps = element.props;
    const fiber = createFiberFromTypeAndProps(type, key, pendingProps, owner, mode, lanes);
    ;
    return fiber;
}
export function createFiberFromFragment(elements: ReactFragment, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    const fiber = createFiber(Fragment, elements, key, mode);
    fiber.lanes = lanes;
    return fiber;
}
function createFiberFromProfiler(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    ;
    const fiber = createFiber(Profiler, pendingProps, key, mode | ProfileMode);
    fiber.elementType = REACT_PROFILER_TYPE;
    fiber.lanes = lanes;
    ;
    return fiber;
}
export function createFiberFromSuspense(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    const fiber = createFiber(SuspenseComponent, pendingProps, key, mode);
    fiber.elementType = REACT_SUSPENSE_TYPE;
    fiber.lanes = lanes;
    return fiber;
}
export function createFiberFromSuspenseList(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    const fiber = createFiber(SuspenseListComponent, pendingProps, key, mode);
    fiber.elementType = REACT_SUSPENSE_LIST_TYPE;
    fiber.lanes = lanes;
    return fiber;
}
export function createFiberFromOffscreen(pendingProps: OffscreenProps, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    const fiber = createFiber(OffscreenComponent, pendingProps, key, mode);
    fiber.lanes = lanes;
    return fiber;
}
export function createFiberFromActivity(pendingProps: ActivityProps, mode: TypeOfMode, lanes: Lanes, key: null | string): Fiber {
    const fiber = createFiber(ActivityComponent, pendingProps, key, mode);
    fiber.elementType = REACT_ACTIVITY_TYPE;
    fiber.lanes = lanes;
    return fiber;
}
export function createFiberFromText(content: string, mode: TypeOfMode, lanes: Lanes): Fiber {
    const fiber = createFiber(HostText, content, null, mode);
    fiber.lanes = lanes;
    return fiber;
}
export function createFiberFromDehydratedFragment(dehydratedNode: SuspenseInstance | ActivityInstance): Fiber {
    const fiber = createFiber(DehydratedFragment, null, null, NoMode);
    fiber.stateNode = dehydratedNode;
    return fiber;
}
export function createFiberFromPortal(portal: ReactPortal, mode: TypeOfMode, lanes: Lanes): Fiber {
    const pendingProps = portal.children !== null ? portal.children : [];
    const fiber = createFiber(HostPortal, pendingProps, portal.key, mode);
    fiber.lanes = lanes;
    fiber.stateNode = {
        containerInfo: portal.containerInfo,
        pendingChildren: null,
        implementation: portal.implementation,
    };
    return fiber;
}
export function createFiberFromThrow(error: unknown, mode: TypeOfMode, lanes: Lanes): Fiber {
    const fiber = createFiber(Throw, error, null, mode);
    fiber.lanes = lanes;
    return fiber;
}
