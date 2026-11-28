/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ValueTracker } from './inputValueTracking';
import { DomNode, nodeOf, pageHandleAbove } from 'dom-stream/dom';
import type { Fiber, FiberRoot } from 'react-reconciler/src/ReactInternalTypes';
import { ActivityComponent,HostComponent,HostHoistable,HostRoot,HostSingleton,HostText,SuspenseComponent } from 'react-reconciler/src/ReactWorkTags';
import type { ReactScopeInstance } from 'shared/ReactTypes';
import type { ReactDOMEventHandleListener } from './ReactDOMEventHandleTypes';
import type { ActivityInstance,Container,HoistableRoot,Instance,Props,RootResources,SuspenseInstance,TextInstance } from './ReactFiberConfigDOM';
import { getParentHydrationBoundary } from './ReactFiberConfigDOM';
// React DOM's private per-node state. The JavaScript build stores each field as an expando under a
// random key (`__reactFiber$…`, `__reactProps$…`, …); nothing outside React reads them, so the typed port
// keeps one record per node in a WeakMap instead. Server-rendered stylesheets carrying Fizz's `_p` promise
// are not recognised (this build never hydrates server HTML).
export type NodeInternals = {
    fiber: Fiber | undefined; // __reactFiber$
    props: Props | undefined; // __reactProps$
    container: Fiber | null | undefined; // __reactContainer$
    eventListenerSet: Set<string> | undefined; // __reactEvents$
    eventHandleListeners: Set<ReactDOMEventHandleListener> | undefined; // __reactListeners$
    resources: RootResources | undefined; // __reactResources$
    hoistable: boolean; // __reactMarker$
    scrollEndTimer: number | null | undefined; // __reactScroll$
    rootContainer: FiberRoot | undefined; // _reactRootContainer (legacy roots)
    stashedDisplay: string | undefined; // _stashedDisplay
    stashedText: string | null | undefined; // _stashedText
    retry: (() => void) | undefined; // _reactRetry
    loadingPromise: Promise<Event> | undefined; // _p
    viewTransition: ViewTransition | null | undefined; // __reactViewTransition
    listening: boolean; // _reactListening<random> (DOMPluginEventSystem)
    valueTracker: ValueTracker | null | undefined; // _valueTracker (inputValueTracking)
};
const nodeInternals: WeakMap<object, NodeInternals> = new WeakMap();
// A bridge node (packages/dom-stream) holds its record itself; anything else (a scope instance) in the WeakMap.
function newNodeInternals(): NodeInternals {
    return {
            fiber: undefined,
            props: undefined,
            container: undefined,
            eventListenerSet: undefined,
            eventHandleListeners: undefined,
            resources: undefined,
            hoistable: false,
            scrollEndTimer: undefined,
            rootContainer: undefined,
            stashedDisplay: undefined,
            stashedText: undefined,
            retry: undefined,
            loadingPromise: undefined,
            viewTransition: undefined,
            listening: false,
            valueTracker: undefined,
    };
}
// The node's record, created on first write.
export function getNodeInternals(node: object): NodeInternals {
    if (node instanceof DomNode) {
        const own = node.internals;
        if (own !== null) return own as NodeInternals;
        const made = newNodeInternals();
        node.internals = made;
        return made;
    }
    let internals = nodeInternals.get(node);
    if (internals === undefined) {
        internals = {
            fiber: undefined,
            props: undefined,
            container: undefined,
            eventListenerSet: undefined,
            eventHandleListeners: undefined,
            resources: undefined,
            hoistable: false,
            scrollEndTimer: undefined,
            rootContainer: undefined,
            stashedDisplay: undefined,
            stashedText: undefined,
            retry: undefined,
            loadingPromise: undefined,
            viewTransition: undefined,
            listening: false,
            valueTracker: undefined,
        };
        nodeInternals.set(node, internals);
    }
    return internals;
}
// The node's record if it has one; reads never create one.
export function peekNodeInternals(node: object): NodeInternals | undefined {
    if (node instanceof DomNode) {
        const own = node.internals;
        return own === null ? undefined : own as NodeInternals;
    }
    return nodeInternals.get(node);
}
export function detachDeletedInstance(node: Instance): void {
    // TODO: This function is only called on host components. I don't think all of
    // these fields are relevant.
    const internals = peekNodeInternals(node);
    if (internals !== undefined) {
        internals.fiber = undefined;
        internals.props = undefined;
        internals.eventListenerSet = undefined;
        internals.eventHandleListeners = undefined;
    }
}
export function precacheFiberNode(hostInst: Fiber, node: Instance | TextInstance | SuspenseInstance | ActivityInstance | ReactScopeInstance): void {
    getNodeInternals(node).fiber = hostInst;
}
export function markContainerAsRoot(hostRoot: Fiber, node: Container): void {
    getNodeInternals(node).container = hostRoot;
}
export function unmarkContainerAsRoot(node: Container): void {
    getNodeInternals(node).container = null;
}
// A page node is looked up as the bridge node it is (an event's relatedTarget, a form the event names).
function bridgeOf(node: object): object | null {
    if (node instanceof DomNode) return node;
    const above = pageHandleAbove(node as Node);
    return above > 0 ? nodeOf(above) : null;
}
export function isContainerMarkedAsRoot(node: object): boolean {
    const bridged = bridgeOf(node);
    return bridged !== null && !!peekNodeInternals(bridged)?.container;
}
// Given a DOM node, return the closest HostComponent or HostText fiber ancestor.
// If the target node is part of a hydrated or not yet rendered subtree, then
// this may also return a SuspenseComponent, ActivityComponent or HostRoot to
// indicate that.
// Conceptually the HostRoot fiber is a child of the Container node. So if you
// pass the Container node as the targetNode, you will not actually get the
// HostRoot back. To get to the HostRoot, you need to pass a child of it.
// The same thing applies to Suspense and Activity boundaries.
// A page node (an event's target) is answered by the page's node table in one call: the nearest bridge node at or above it. When that
// is an ancestor, the walk starts there, as React's walk over the page's parents would reach it (the page nodes between are not
// React's; a dehydrated boundary among them is not looked for, as this build does not hydrate).
export function getClosestInstanceFromNode(target: object): null | Fiber {
    let targetNode: DomNode;
    let parentNode: DomNode | null;
    let targetInst: Fiber | null | undefined;
    const above = target instanceof DomNode ? target.handle : pageHandleAbove(target as Node);
    const start = nodeOf(above < 0 ? -above : above);
    if (start === null) {
        return null;
    }
    if (above > 0) {
        targetInst = peekNodeInternals(start)?.fiber;
        if (targetInst) {
            // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
            return targetInst;
        }
        targetNode = start;
        parentNode = start.parentNode;
    }
    else {
        targetNode = start;
        parentNode = start;
    }
    // If the direct event target isn't a React owned DOM node, we need to look
    // to see if one of its parents is a React owned DOM node.
    while (parentNode) {
        // We'll check if this is a container root that could include
        // React nodes in the future. We need to check this first because
        // if we're a child of a dehydrated container, we need to first
        // find that inner container before moving on to finding the parent
        // instance. Note that we don't check this field on  the targetNode
        // itself because the fibers are conceptually between the container
        // node and the first child. It isn't surrounding the container node.
        // If it's not a container, we check if it's an instance.
        const parentInternals = peekNodeInternals(parentNode);
        targetInst =
            parentInternals?.container ||
                parentInternals?.fiber;
        if (targetInst) {
            // Since this wasn't the direct target of the event, we might have
            // stepped past dehydrated DOM nodes to get here. However they could
            // also have been non-React nodes. We need to answer which one.
            // If we the instance doesn't have any children, then there can't be
            // a nested suspense boundary within it. So we can use this as a fast
            // bailout. Most of the time, when people add non-React children to
            // the tree, it is using a ref to a child-less DOM node.
            // Normally we'd only need to check one of the fibers because if it
            // has ever gone from having children to deleting them or vice versa
            // it would have deleted the dehydrated boundary nested inside already.
            // However, since the HostRoot starts out with an alternate it might
            // have one on the alternate so we need to check in case this was a
            // root.
            const alternate = targetInst.alternate;
            if (targetInst.child !== null ||
                (alternate !== null && alternate.child !== null)) {
                // Next we need to figure out if the node that skipped past is
                // nested within a dehydrated boundary and if so, which one.
                let hydrationInstance = getParentHydrationBoundary(targetNode);
                while (hydrationInstance !== null) {
                    // We found a suspense instance. That means that we haven't
                    // hydrated it yet. Even though we leave the comments in the
                    // DOM after hydrating, and there are boundaries in the DOM
                    // that could already be hydrated, we wouldn't have found them
                    // through this pass since if the target is hydrated it would
                    // have had an internalInstanceKey on it.
                    // Let's get the fiber associated with the SuspenseComponent
                    // as the deepest instance.
                    const targetFiber = peekNodeInternals(hydrationInstance)?.fiber;
                    if (targetFiber) {
                        return targetFiber;
                    }
                    // If we don't find a Fiber on the comment, it might be because
                    // we haven't gotten to hydrate it yet. There might still be a
                    // parent boundary that hasn't above this one so we need to find
                    // the outer most that is known.
                    hydrationInstance = getParentHydrationBoundary(hydrationInstance);
                    // If we don't find one, then that should mean that the parent
                    // host component also hasn't hydrated yet. We can return it
                    // below since it will bail out on the isMounted check later.
                }
            }
            return targetInst;
        }
        targetNode = parentNode;
        parentNode = targetNode.parentNode;
    }
    return null;
}
/**
 * Given a DOM node, return the ReactDOMComponent or ReactDOMTextComponent
 * instance, or null if the node was not rendered by this React.
 */
export function getInstanceFromNode(target: object): Fiber | null {
    // A page node is the bridge node it is, if any (no ancestor stands for it here).
    let node: object | null = target;
    if (!(target instanceof DomNode)) {
        const above = pageHandleAbove(target as Node);
        node = above > 0 ? nodeOf(above) : null;
        if (node === null) {
            return null;
        }
    }
    const internals = peekNodeInternals(node);
    const inst = internals?.fiber ||
        internals?.container;
    if (inst) {
        const tag = inst.tag;
        if (tag === HostComponent ||
            tag === HostText ||
            tag === SuspenseComponent ||
            tag === ActivityComponent ||
            tag === HostHoistable ||
            tag === HostSingleton ||
            tag === HostRoot) {
            return inst;
        }
        else {
            return null;
        }
    }
    return null;
}
/**
 * Given a ReactDOMComponent or ReactDOMTextComponent, return the corresponding
 * DOM node.
 */
export function getNodeFromInstance(inst: Fiber): Instance | TextInstance {
    const tag = inst.tag;
    if (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton ||
        tag === HostText) {
        // In Fiber this, is just the state node right now. We assume it will be
        // a host component or host text.
        return inst.stateNode;
    }
    // Without this first invariant, passing a non-DOM-component triggers the next
    // invariant for a missing parent, which is super confusing.
    throw new Error('getNodeFromInstance: Invalid argument.');
}
export function getFiberCurrentPropsFromNode(node: object): Props | null {
    const bridged = bridgeOf(node);
    return bridged === null ? null : peekNodeInternals(bridged)?.props || null;
}
export function updateFiberProps(node: Instance, props: Props): void {
    getNodeInternals(node).props = props;
}
export function getEventListenerSet(node: object): Set<string> {
    const internals = getNodeInternals(node);
    let elementListenerSet = internals.eventListenerSet;
    if (elementListenerSet === undefined) {
        elementListenerSet = internals.eventListenerSet = new Set();
    }
    return elementListenerSet;
}
export function getEventHandlerListeners(scope: EventTarget | ReactScopeInstance): null | Set<ReactDOMEventHandleListener> {
    return peekNodeInternals(scope)?.eventHandleListeners || null;
}
export function getResourcesFromRoot(root: HoistableRoot): RootResources {
    const internals = getNodeInternals(root);
    let resources = internals.resources;
    if (!resources) {
        resources = internals.resources = {
            hoistableStyles: new Map(),
            hoistableScripts: new Map(),
        };
    }
    return resources;
}
export function isMarkedHoistable(node: object): boolean {
    return !!peekNodeInternals(node)?.hoistable;
}
export function markNodeAsHoistable(node: object) {
    getNodeInternals(node).hoistable = true;
}
export function getScrollEndTimer(node: EventTarget): number | null | undefined {
    return peekNodeInternals(node)?.scrollEndTimer;
}
export function setScrollEndTimer(node: EventTarget, timer: number): void {
    getNodeInternals(node).scrollEndTimer = timer;
}
export function clearScrollEndTimer(node: EventTarget): void {
    const internals = peekNodeInternals(node);
    if (internals !== undefined) {
        internals.scrollEndTimer = undefined;
    }
}
export function isOwnedInstance(node: object): boolean {
    const internals = peekNodeInternals(node);
    return !!(internals?.hoistable || internals?.fiber);
}
