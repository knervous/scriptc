/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ActivityInstance,ChildSet,Container,FragmentInstanceType,Instance,SuspenseInstance,TextInstance } from './ReactFiberConfig';
import { acquireSingletonInstance,appendChild,appendChildToContainer,commitHydratedActivityInstance,commitHydratedContainer,commitHydratedInstance,commitHydratedSuspenseInstance,commitMount,commitNewChildToFragmentInstance,commitTextUpdate,commitUpdate,hideDehydratedBoundary,hideInstance,hideTextInstance,insertBefore,insertInContainerBefore,isSingletonScope,releaseSingletonInstance,removeChild,removeChildFromContainer,replaceContainerChildren,resetTextContent,supportsMutation,supportsResources,supportsSingletons,unhideDehydratedBoundary,unhideInstance,unhideTextInstance } from './ReactFiberConfig';
import { ContentReset,Placement } from './ReactFiberFlags';
import { trackHostMutation } from './ReactFiberMutationTracking';
import { captureCommitPhaseError } from './ReactFiberWorkLoop';
import type { Fiber,FiberRoot } from './ReactInternalTypes';
import { DehydratedFragment,HostComponent,HostHoistable,HostPortal,HostRoot,HostSingleton,HostText } from './ReactWorkTags';
export function commitHostMount(finishedWork: Fiber) {
    const type = finishedWork.type;
    const props = finishedWork.memoizedProps;
    const instance: Instance = finishedWork.stateNode;
    try {
        {
            commitMount(instance, type, props, finishedWork);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostHydratedInstance(finishedWork: Fiber) {
    const type = finishedWork.type;
    const props = finishedWork.memoizedProps;
    const instance: Instance = finishedWork.stateNode;
    try {
        {
            commitHydratedInstance(instance, type, props, finishedWork);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostUpdate(finishedWork: Fiber, newProps: any, oldProps: any): void {
    try {
        {
            commitUpdate(finishedWork.stateNode, finishedWork.type, oldProps, newProps, finishedWork);
        }
        // Mutations are tracked manually from within commitUpdate.
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostTextUpdate(finishedWork: Fiber, newText: string, oldText: string) {
    const textInstance: TextInstance = finishedWork.stateNode;
    try {
        {
            commitTextUpdate(textInstance, oldText, newText);
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostResetTextContent(finishedWork: Fiber) {
    const instance: Instance = finishedWork.stateNode;
    try {
        {
            resetTextContent(instance);
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitShowHideSuspenseBoundary(node: Fiber, isHidden: boolean) {
    try {
        const instance = node.stateNode;
        if (isHidden) {
            {
                hideDehydratedBoundary(instance);
            }
        }
        else {
            {
                unhideDehydratedBoundary(node.stateNode);
            }
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(node, node.return, error);
    }
}
export function commitShowHideHostInstance(node: Fiber, isHidden: boolean) {
    try {
        const instance = node.stateNode;
        if (isHidden) {
            {
                hideInstance(instance);
            }
        }
        else {
            {
                unhideInstance(node.stateNode, node.memoizedProps);
            }
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(node, node.return, error);
    }
}
export function commitShowHideHostTextInstance(node: Fiber, isHidden: boolean) {
    try {
        const instance = node.stateNode;
        if (isHidden) {
            {
                hideTextInstance(instance);
            }
        }
        else {
            {
                unhideTextInstance(instance, node.memoizedProps);
            }
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(node, node.return, error);
    }
}
function isHostParent(fiber: Fiber): boolean {
    return (fiber.tag === HostComponent ||
        fiber.tag === HostRoot ||
        (supportsResources ? fiber.tag === HostHoistable : false) ||
        (supportsSingletons
            ? fiber.tag === HostSingleton && isSingletonScope(fiber.type)
            : false) ||
        fiber.tag === HostPortal);
}
function getHostSibling(fiber: Fiber): Instance | null | undefined {
    // We're going to search forward into the tree until we find a sibling host
    // node. Unfortunately, if multiple insertions are done in a row we have to
    // search past them. This leads to exponential search for the next sibling.
    // TODO: Find a more efficient way to do this.
    let node: Fiber = fiber;
    siblings: while (true) {
        // If we didn't find anything, let's try the next sibling.
        while (node.sibling === null) {
            if (node.return === null || isHostParent(node.return)) {
                // If we pop out of the root or hit the parent the fiber we are the
                // last sibling.
                return null;
            }
            node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
        while (node.tag !== HostComponent &&
            node.tag !== HostText &&
            node.tag !== DehydratedFragment) {
            // If this is a host singleton we go deeper if it's not a special
            // singleton scope. If it is a singleton scope we skip over it because
            // you only insert against this scope when you are already inside of it
            if (supportsSingletons &&
                node.tag === HostSingleton &&
                isSingletonScope(node.type)) {
                continue siblings;
            }
            // If it is not host node and, we might have a host node inside it.
            // Try to search down until we find one.
            if (node.flags & Placement) {
                // If we don't have a child, try the siblings instead.
                continue siblings;
            }
            // If we don't have a child, try the siblings instead.
            // We also skip portals because they are not part of this host tree.
            if (node.child === null || node.tag === HostPortal) {
                continue siblings;
            }
            else {
                node.child.return = node;
                node = node.child;
            }
        }
        // Check if this host node is stable or about to be placed.
        if (!(node.flags & Placement)) {
            // Found it!
            return node.stateNode;
        }
    }
}
function insertOrAppendPlacementNodeIntoContainer(node: Fiber, before: Instance | null | undefined, parent: Container, parentFragmentInstances: null | Array<FragmentInstanceType>): void {
    const { tag } = node;
    const isHost = tag === HostComponent || tag === HostText;
    if (isHost) {
        const stateNode = node.stateNode;
        if (before) {
            insertInContainerBefore(parent, stateNode, before);
        }
        else {
            appendChildToContainer(parent, stateNode);
        }
        ;
        trackHostMutation();
        return;
    }
    else if (tag === HostPortal) {
        // If the insertion itself is a portal, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
        return;
    }
    if ((supportsSingletons ? tag === HostSingleton : false) &&
        isSingletonScope(node.type)) {
        // This singleton is the parent of deeper nodes and needs to become
        // the parent for child insertions and appends
        parent = node.stateNode;
        before = null;
    }
    const child = node.child;
    if (child !== null) {
        insertOrAppendPlacementNodeIntoContainer(child, before, parent, parentFragmentInstances);
        let sibling = child.sibling;
        while (sibling !== null) {
            insertOrAppendPlacementNodeIntoContainer(sibling, before, parent, parentFragmentInstances);
            sibling = sibling.sibling;
        }
    }
}
function insertOrAppendPlacementNode(node: Fiber, before: Instance | null | undefined, parent: Instance, parentFragmentInstances: null | Array<FragmentInstanceType>): void {
    const { tag } = node;
    const isHost = tag === HostComponent || tag === HostText;
    if (isHost) {
        const stateNode = node.stateNode;
        if (before) {
            insertBefore(parent, stateNode, before);
        }
        else {
            appendChild(parent, stateNode);
        }
        ;
        trackHostMutation();
        return;
    }
    else if (tag === HostPortal) {
        // If the insertion itself is a portal, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
        return;
    }
    if ((supportsSingletons ? tag === HostSingleton : false) &&
        isSingletonScope(node.type)) {
        // This singleton is the parent of deeper nodes and needs to become
        // the parent for child insertions and appends
        parent = node.stateNode;
    }
    const child = node.child;
    if (child !== null) {
        insertOrAppendPlacementNode(child, before, parent, parentFragmentInstances);
        let sibling = child.sibling;
        while (sibling !== null) {
            insertOrAppendPlacementNode(sibling, before, parent, parentFragmentInstances);
            sibling = sibling.sibling;
        }
    }
}
function commitPlacement(finishedWork: Fiber): void {
    // Recursively insert all host nodes into the parent.
    let hostParentFiber;
    let parentFragmentInstances = null;
    let parentFiber = finishedWork.return;
    while (parentFiber !== null) {
        ;
        if (isHostParent(parentFiber)) {
            hostParentFiber = parentFiber;
            break;
        }
        parentFiber = parentFiber.return;
    }
    if (!supportsMutation) {
        ;
        return;
    }
    if (hostParentFiber == null) {
        throw new Error('Expected to find a host parent. This error is likely caused by a bug ' +
            'in React. Please file an issue.');
    }
    switch (hostParentFiber.tag) {
        case HostSingleton: {
            if (supportsSingletons) {
                const parent: Instance = hostParentFiber.stateNode;
                const before = getHostSibling(finishedWork);
                // We only have the top Fiber that was inserted but we need to recurse down its
                // children to find all the terminal nodes.
                insertOrAppendPlacementNode(finishedWork, before, parent, parentFragmentInstances);
                break;
            }
            // Fall through
        }
        case HostComponent: {
            const parent: Instance = hostParentFiber.stateNode;
            if (hostParentFiber.flags & ContentReset) {
                // Reset the text content of the parent before doing any insertions
                resetTextContent(parent);
                // Clear ContentReset from the effect tag
                hostParentFiber.flags &= ~ContentReset;
            }
            const before = getHostSibling(finishedWork);
            // We only have the top Fiber that was inserted but we need to recurse down its
            // children to find all the terminal nodes.
            insertOrAppendPlacementNode(finishedWork, before, parent, parentFragmentInstances);
            break;
        }
        case HostRoot:
        case HostPortal: {
            const parent: Container = hostParentFiber.stateNode.containerInfo;
            const before = getHostSibling(finishedWork);
            insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent, parentFragmentInstances);
            break;
        }
        default:
            throw new Error('Invalid host parent fiber. This error is likely caused by a bug ' +
                'in React. Please file an issue.');
    }
}
export function commitHostPlacement(finishedWork: Fiber) {
    try {
        {
            commitPlacement(finishedWork);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostRemoveChildFromContainer(deletedFiber: Fiber, nearestMountedAncestor: Fiber, parentContainer: Container, hostInstance: Instance | TextInstance) {
    try {
        {
            removeChildFromContainer(parentContainer, hostInstance);
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
    }
}
export function commitHostRemoveChild(deletedFiber: Fiber, nearestMountedAncestor: Fiber, parentInstance: Instance, hostInstance: Instance | TextInstance) {
    try {
        {
            removeChild(parentInstance, hostInstance);
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
    }
}
export function commitHostRootContainerChildren(root: FiberRoot, finishedWork: Fiber) {
    const containerInfo = root.containerInfo;
    const pendingChildren = root.pendingChildren;
    try {
        {
            replaceContainerChildren(containerInfo, pendingChildren);
        }
        trackHostMutation();
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostPortalContainerChildren(portal: {
    containerInfo: Container;
    pendingChildren: ChildSet;
}, finishedWork: Fiber, pendingChildren: ChildSet) {
    const containerInfo = portal.containerInfo;
    try {
        {
            replaceContainerChildren(containerInfo, pendingChildren);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostHydratedContainer(root: FiberRoot, finishedWork: Fiber) {
    try {
        {
            commitHydratedContainer(root.containerInfo);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostHydratedActivity(activityInstance: ActivityInstance, finishedWork: Fiber) {
    try {
        {
            commitHydratedActivityInstance(activityInstance);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostHydratedSuspense(suspenseInstance: SuspenseInstance, finishedWork: Fiber) {
    try {
        {
            commitHydratedSuspenseInstance(suspenseInstance);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostSingletonAcquisition(finishedWork: Fiber) {
    const singleton = finishedWork.stateNode;
    const props = finishedWork.memoizedProps;
    try {
        {
            acquireSingletonInstance(finishedWork.type, props, singleton, finishedWork);
        }
    }
    catch (error: unknown) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
}
export function commitHostSingletonRelease(releasingWork: Fiber) {
    {
        releaseSingletonInstance(releasingWork.stateNode);
    }
}
