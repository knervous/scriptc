/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ReactContext,ReactScopeInstance,ReactScopeQuery } from 'shared/ReactTypes';
import { getInstanceFromNode,getInstanceFromScope } from './ReactFiberConfig';
import { isFiberSuspenseAndTimedOut } from './ReactFiberTreeReflection';
import type { Fiber } from './ReactInternalTypes';
import { ContextProvider,ScopeComponent } from './ReactWorkTags';
function getSuspenseFallbackChild(fiber: Fiber): Fiber | null {
    return ((fiber.child as Fiber).sibling as Fiber).child;
}
function collectScopedNodes(node: Fiber, fn: ReactScopeQuery, scopedNodes: Array<any>): void {
    ;
}
function collectFirstScopedNode(node: Fiber, fn: ReactScopeQuery): null | Record<any, any> {
    ;
    return null;
}
function collectScopedNodesFromChildren(startingChild: Fiber, fn: ReactScopeQuery, scopedNodes: Array<any>): void {
    let child: null | Fiber = startingChild;
    while (child !== null) {
        collectScopedNodes(child, fn, scopedNodes);
        child = child.sibling;
    }
}
function collectFirstScopedNodeFromChildren(startingChild: Fiber, fn: ReactScopeQuery): Record<any, any> | null {
    let child: null | Fiber = startingChild;
    while (child !== null) {
        const scopedNode = collectFirstScopedNode(child, fn);
        if (scopedNode !== null) {
            return scopedNode;
        }
        child = child.sibling;
    }
    return null;
}
function collectNearestContextValues<T>(node: Fiber, context: ReactContext<T>, childContextValues: Array<T>): void {
    if (node.tag === ContextProvider && node.type === context) {
        const contextValue = node.memoizedProps.value;
        childContextValues.push(contextValue);
    }
    else {
        let child = node.child;
        if (isFiberSuspenseAndTimedOut(node)) {
            child = getSuspenseFallbackChild(node);
        }
        if (child !== null) {
            collectNearestChildContextValues(child, context, childContextValues);
        }
    }
}
function collectNearestChildContextValues<T>(startingChild: Fiber | null, context: ReactContext<T>, childContextValues: Array<T>): void {
    let child = startingChild;
    while (child !== null) {
        collectNearestContextValues(child, context, childContextValues);
        child = child.sibling;
    }
}
function DO_NOT_USE_queryAllNodes(this: any, fn: ReactScopeQuery): null | Array<Record<any, any>> {
    const currentFiber = getInstanceFromScope(this);
    if (currentFiber === null) {
        return null;
    }
    const child = currentFiber.child;
    const scopedNodes: Array<any> = [];
    if (child !== null) {
        collectScopedNodesFromChildren(child, fn, scopedNodes);
    }
    return scopedNodes.length === 0 ? null : scopedNodes;
}
function DO_NOT_USE_queryFirstNode(this: any, fn: ReactScopeQuery): null | Record<any, any> {
    const currentFiber = getInstanceFromScope(this);
    if (currentFiber === null) {
        return null;
    }
    const child = currentFiber.child;
    if (child !== null) {
        return collectFirstScopedNodeFromChildren(child, fn);
    }
    return null;
}
function containsNode(this: unknown, node: Node): boolean {
    let fiber = getInstanceFromNode(node);
    while (fiber !== null) {
        if (fiber.tag === ScopeComponent && fiber.stateNode === this) {
            return true;
        }
        fiber = fiber.return;
    }
    return false;
}
function getChildContextValues<T>(this: any, context: ReactContext<T>): Array<T> {
    const currentFiber = getInstanceFromScope(this);
    if (currentFiber === null) {
        return [];
    }
    const child = currentFiber.child;
    const childContextValues: Array<T> = [];
    if (child !== null) {
        collectNearestChildContextValues(child, context, childContextValues);
    }
    return childContextValues;
}
export function createScopeInstance(): ReactScopeInstance {
    return {
        DO_NOT_USE_queryAllNodes,
        DO_NOT_USE_queryFirstNode,
        containsNode,
        getChildContextValues,
    };
}
