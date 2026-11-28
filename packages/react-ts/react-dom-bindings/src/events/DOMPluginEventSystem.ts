/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { DomNode, page, type DomElement } from 'dom-stream/dom';
import { getNodeInternals, peekNodeInternals } from '../client/ReactDOMComponentTree';
import { getLowestCommonAncestor } from 'react-reconciler/src/ReactFiberTreeReflection';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
import { HostComponent,HostHoistable,HostPortal,HostRoot,HostSingleton,HostText } from 'react-reconciler/src/ReactWorkTags';
import reportGlobalError from 'shared/reportGlobalError';
import { DOCUMENT_NODE } from '../client/HTMLNodeType';
import { getClosestInstanceFromNode,getEventHandlerListeners,getEventListenerSet } from '../client/ReactDOMComponentTree';
import { passiveBrowserEventsSupported } from './checkPassiveEvents';
import type { DOMEventName } from './DOMEventNames';
import { addEventBubbleListener,addEventBubbleListenerWithPassiveFlag,addEventCaptureListener,addEventCaptureListenerWithPassiveFlag } from './EventListener';
import { allNativeEvents } from './EventRegistry';
import type { EventSystemFlags } from './EventSystemFlags';
import { IS_CAPTURE_PHASE,IS_EVENT_HANDLE_NON_MANAGED_NODE,IS_NON_DELEGATED,SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS } from './EventSystemFlags';
import getEventTarget from './getEventTarget';
import getListener, { type EventHandler } from './getListener';
import type { AnyNativeEvent } from './PluginModuleType';
import * as BeforeInputEventPlugin from './plugins/BeforeInputEventPlugin';
import * as ChangeEventPlugin from './plugins/ChangeEventPlugin';
import * as EnterLeaveEventPlugin from './plugins/EnterLeaveEventPlugin';
import * as FormActionEventPlugin from './plugins/FormActionEventPlugin';
import * as SelectEventPlugin from './plugins/SelectEventPlugin';
import * as SimpleEventPlugin from './plugins/SimpleEventPlugin';
import { createEventListenerWrapperWithPriority } from './ReactDOMEventListener';
import { batchedUpdates } from './ReactDOMUpdateBatching';
import type { KnownReactSyntheticEvent,ReactSyntheticEvent } from './ReactSyntheticEventType';
type DispatchListener = {
    instance: null | Fiber;
    listener: EventHandler;
    currentTarget: EventTarget | DomNode;
};
type DispatchEntry = {
    event: ReactSyntheticEvent;
    listeners: Array<DispatchListener>;
};
export type DispatchQueue = Array<DispatchEntry>;
// TODO: remove top-level side effect.
SimpleEventPlugin.registerEvents();
EnterLeaveEventPlugin.registerEvents();
ChangeEventPlugin.registerEvents();
SelectEventPlugin.registerEvents();
BeforeInputEventPlugin.registerEvents();
;
function extractEvents(dispatchQueue: DispatchQueue, domEventName: DOMEventName, targetInst: null | Fiber, nativeEvent: AnyNativeEvent, nativeEventTarget: null | EventTarget, eventSystemFlags: EventSystemFlags, targetContainer: DomNode) {
    // TODO: we should remove the concept of a "SimpleEventPlugin".
    // This is the basic functionality of the event system. All
    // the other plugins are essentially polyfills. So the plugin
    // should probably be inlined somewhere and have its logic
    // be core the to event system. This would potentially allow
    // us to ship builds of React without the polyfilled plugins below.
    SimpleEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
    const shouldProcessPolyfillPlugins = (eventSystemFlags & SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS) === 0;
    // We don't process these events unless we are in the
    // event's native "bubble" phase, which means that we're
    // not in the capture phase. That's because we emulate
    // the capture phase here still. This is a trade-off,
    // because in an ideal world we would not emulate and use
    // the phases properly, like we do with the SimpleEvent
    // plugin. However, the plugins below either expect
    // emulation (EnterLeave) or use state localized to that
    // plugin (BeforeInput, Change, Select). The state in
    // these modules complicates things, as you'll essentially
    // get the case where the capture phase event might change
    // state, only for the following bubble event to come in
    // later and not trigger anything as the state now
    // invalidates the heuristics of the event plugin. We
    // could alter all these plugins to work in such ways, but
    // that might cause other unknown side-effects that we
    // can't foresee right now.
    if (shouldProcessPolyfillPlugins) {
        EnterLeaveEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
        ChangeEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
        SelectEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
        BeforeInputEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
        FormActionEventPlugin.extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
    }
    ;
}
// List of events that need to be individually attached to media elements.
export const mediaEventTypes: Array<DOMEventName> = [
    'abort',
    'canplay',
    'canplaythrough',
    'durationchange',
    'emptied',
    'encrypted',
    'ended',
    'error',
    'loadeddata',
    'loadedmetadata',
    'loadstart',
    'pause',
    'play',
    'playing',
    'progress',
    'ratechange',
    'resize',
    'seeked',
    'seeking',
    'stalled',
    'suspend',
    'timeupdate',
    'volumechange',
    'waiting',
];
// We should not delegate these events to the container, but rather
// set them on the actual target element itself. This is primarily
// because these events do not consistently bubble in the DOM.
export const nonDelegatedEvents: Set<DOMEventName> = new Set([
    'beforetoggle',
    'cancel',
    'close',
    'invalid',
    'load',
    'scroll',
    'scrollend',
    'toggle',
    // In order to reduce bytes, we insert the above array of media events
    // into this Set. Note: the "error" event isn't an exclusive media event,
    // and can occur on other elements too. Rather than duplicate that event,
    // we just take it from the media events array.
    ...mediaEventTypes,
]);
function executeDispatch(event: ReactSyntheticEvent, listener: EventHandler, currentTarget: EventTarget | DomNode): void {
    // The page's node, as user code sees it (a bridge node is materialized once).
    event.currentTarget = currentTarget instanceof DomNode ? page(currentTarget) : currentTarget;
    try {
        listener(event);
    }
    catch (error) {
        reportGlobalError(error);
    }
    event.currentTarget = null;
}
function processDispatchQueueItemsInOrder(event: ReactSyntheticEvent, dispatchListeners: Array<DispatchListener>, inCapturePhase: boolean): void {
    let previousInstance;
    if (inCapturePhase) {
        for (let i = dispatchListeners.length - 1; i >= 0; i--) {
            const { instance, currentTarget, listener } = dispatchListeners[i];
            if (instance !== previousInstance && event.isPropagationStopped()) {
                return;
            }
            {
                executeDispatch(event, listener, currentTarget);
            }
            previousInstance = instance;
        }
    }
    else {
        for (let i = 0; i < dispatchListeners.length; i++) {
            const { instance, currentTarget, listener } = dispatchListeners[i];
            if (instance !== previousInstance && event.isPropagationStopped()) {
                return;
            }
            {
                executeDispatch(event, listener, currentTarget);
            }
            previousInstance = instance;
        }
    }
}
export function processDispatchQueue(dispatchQueue: DispatchQueue, eventSystemFlags: EventSystemFlags): void {
    const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;
    for (let i = 0; i < dispatchQueue.length; i++) {
        const { event, listeners } = dispatchQueue[i];
        processDispatchQueueItemsInOrder(event, listeners, inCapturePhase);
        //  event system doesn't use pooling.
    }
}
function dispatchEventsForPlugins(domEventName: DOMEventName, eventSystemFlags: EventSystemFlags, nativeEvent: AnyNativeEvent, targetInst: null | Fiber, targetContainer: DomNode): void {
    const nativeEventTarget = getEventTarget(nativeEvent);
    const dispatchQueue: DispatchQueue = [];
    extractEvents(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget, eventSystemFlags, targetContainer);
    processDispatchQueue(dispatchQueue, eventSystemFlags);
}
export function listenToNonDelegatedEvent(domEventName: DOMEventName, targetElement: DomElement): void {
    ;
    const isCapturePhaseListener = false;
    const listenerSet = getEventListenerSet(targetElement);
    const listenerSetKey = getListenerSetKey(domEventName, isCapturePhaseListener);
    if (!listenerSet.has(listenerSetKey)) {
        addTrappedEventListener(targetElement, domEventName, IS_NON_DELEGATED, isCapturePhaseListener);
        listenerSet.add(listenerSetKey);
    }
}
export function listenToNativeEvent(domEventName: DOMEventName, isCapturePhaseListener: boolean, target: DomNode): void {
    ;
    let eventSystemFlags = 0;
    if (isCapturePhaseListener) {
        eventSystemFlags |= IS_CAPTURE_PHASE;
    }
    addTrappedEventListener(target, domEventName, eventSystemFlags, isCapturePhaseListener);
}
// React's `_reactListening<random>` expando is the `listening` flag of the node's record (ReactDOMComponentTree).
// Every container is a bridge node (dom-stream): its listeners go through the stream.
export function listenToAllSupportedEvents(rootContainerElement: DomNode) {
    if (!peekNodeInternals(rootContainerElement)?.listening) {
        getNodeInternals(rootContainerElement).listening = true;
        allNativeEvents.forEach((domEventName) => {
            // We handle selectionchange separately because it
            // doesn't bubble and needs to be on the document.
            if (domEventName !== 'selectionchange') {
                if (!nonDelegatedEvents.has(domEventName)) {
                    listenToNativeEvent(domEventName, false, rootContainerElement);
                }
                listenToNativeEvent(domEventName, true, rootContainerElement);
            }
        });
        const rootNode = rootContainerElement;
        const ownerDocument = rootNode.nodeType === DOCUMENT_NODE
            ? rootNode
            : rootNode.ownerDocument;
        if (ownerDocument !== null) {
            // The selectionchange event also needs deduplication
            // but it is attached to the document.
            if (!peekNodeInternals(ownerDocument)?.listening) {
                getNodeInternals(ownerDocument).listening = true;
                listenToNativeEvent('selectionchange', false, ownerDocument);
            }
        }
    }
}
function addTrappedEventListener(targetContainer: DomNode, domEventName: DOMEventName, eventSystemFlags: EventSystemFlags, isCapturePhaseListener: boolean, isDeferredListenerForLegacyFBSupport?: boolean) {
    let listener = createEventListenerWrapperWithPriority(targetContainer, domEventName, eventSystemFlags);
    // If passive option is not supported, then the event will be
    // active and not passive.
    let isPassiveListener: undefined | boolean = undefined;
    if (passiveBrowserEventsSupported) {
        // Browsers introduced an intervention, making these events
        // passive by default on document. React doesn't bind them
        // to document anymore, but changing this now would undo
        // the performance wins from the change. So we emulate
        // the existing behavior manually on the roots now.
        // https://github.com/facebook/react/issues/19651
        if (domEventName === 'touchstart' ||
            domEventName === 'touchmove' ||
            domEventName === 'wheel') {
            isPassiveListener = true;
        }
    }
    targetContainer =
        targetContainer;
    let unsubscribeListener;
    ;
    // TODO: There are too many combinations here. Consolidate them.
    if (isCapturePhaseListener) {
        if (isPassiveListener !== undefined) {
            unsubscribeListener = addEventCaptureListenerWithPassiveFlag(targetContainer, domEventName, listener, isPassiveListener);
        }
        else {
            unsubscribeListener = addEventCaptureListener(targetContainer, domEventName, listener);
        }
    }
    else {
        if (isPassiveListener !== undefined) {
            unsubscribeListener = addEventBubbleListenerWithPassiveFlag(targetContainer, domEventName, listener, isPassiveListener);
        }
        else {
            unsubscribeListener = addEventBubbleListener(targetContainer, domEventName, listener);
        }
    }
}
// The listener's container and a root's are both bridge nodes (dom-stream).
function isMatchingRootContainer(grandContainer: DomNode, targetContainer: DomNode): boolean {
    return (grandContainer === targetContainer ||
        (false));
}
export function dispatchEventForPluginEventSystem(domEventName: DOMEventName, eventSystemFlags: EventSystemFlags, nativeEvent: AnyNativeEvent, targetInst: null | Fiber, targetContainer: DomNode): void {
    let ancestorInst = targetInst;
    if ((eventSystemFlags & IS_EVENT_HANDLE_NON_MANAGED_NODE) === 0 &&
        (eventSystemFlags & IS_NON_DELEGATED) === 0) {
        const targetContainerNode = targetContainer;
        ;
        if (targetInst !== null) {
            // The below logic attempts to work out if we need to change
            // the target fiber to a different ancestor. We had similar logic
            // in the legacy event system, except the big difference between
            // systems is that the modern event system now has an event listener
            // attached to each React Root and React Portal Root. Together,
            // the DOM nodes representing these roots are the "rootContainer".
            // To figure out which ancestor instance we should use, we traverse
            // up the fiber tree from the target instance and attempt to find
            // root boundaries that match that of our current "rootContainer".
            // If we find that "rootContainer", we find the parent fiber
            // sub-tree for that root and make that our ancestor instance.
            let node: null | Fiber = targetInst;
            mainLoop: while (true) {
                if (node === null) {
                    return;
                }
                const nodeTag = node.tag;
                if (nodeTag === HostRoot || nodeTag === HostPortal) {
                    let container = node.stateNode.containerInfo;
                    if (isMatchingRootContainer(container, targetContainerNode)) {
                        break;
                    }
                    if (nodeTag === HostPortal) {
                        // The target is a portal, but it's not the rootContainer we're looking for.
                        // Normally portals handle their own events all the way down to the root.
                        // So we should be able to stop now. However, we don't know if this portal
                        // was part of *our* root.
                        let grandNode = node.return;
                        while (grandNode !== null) {
                            const grandTag = grandNode.tag;
                            if (grandTag === HostRoot || grandTag === HostPortal) {
                                const grandContainer = grandNode.stateNode.containerInfo;
                                if (isMatchingRootContainer(grandContainer, targetContainerNode)) {
                                    // This is the rootContainer we're looking for and we found it as
                                    // a parent of the Portal. That means we can ignore it because the
                                    // Portal will bubble through to us.
                                    return;
                                }
                            }
                            grandNode = grandNode.return;
                        }
                    }
                    // Now we need to find it's corresponding host fiber in the other
                    // tree. To do this we can use getClosestInstanceFromNode, but we
                    // need to validate that the fiber is a host instance, otherwise
                    // we need to traverse up through the DOM till we find the correct
                    // node that is from the other tree.
                    while (container !== null) {
                        const parentNode = getClosestInstanceFromNode(container);
                        if (parentNode === null) {
                            return;
                        }
                        const parentTag = parentNode.tag;
                        if (parentTag === HostComponent ||
                            parentTag === HostText ||
                            parentTag === HostHoistable ||
                            parentTag === HostSingleton) {
                            node = ancestorInst = parentNode;
                            continue mainLoop;
                        }
                        container = container.parentNode;
                    }
                }
                node = node.return;
            }
        }
    }
    batchedUpdates(() => dispatchEventsForPlugins(domEventName, eventSystemFlags, nativeEvent, ancestorInst, targetContainer));
}
function createDispatchListener(instance: null | Fiber, listener: EventHandler, currentTarget: EventTarget | DomNode): DispatchListener {
    return {
        instance,
        listener,
        currentTarget,
    };
}
export function accumulateSinglePhaseListeners(targetFiber: Fiber | null, reactName: string | null, nativeEventType: string, inCapturePhase: boolean, accumulateTargetOnly: boolean, nativeEvent: AnyNativeEvent): Array<DispatchListener> {
    const captureName = reactName !== null ? reactName + 'Capture' : null;
    const reactEventName = inCapturePhase ? captureName : reactName;
    let listeners: Array<DispatchListener> = [];
    let instance = targetFiber;
    let lastHostComponent = null;
    // Accumulate all instances and listeners via the target -> root path.
    while (instance !== null) {
        const { stateNode, tag } = instance;
        // Handle listeners that are on HostComponents (i.e. <div>)
        if ((tag === HostComponent ||
            tag === HostHoistable ||
            tag === HostSingleton) &&
            stateNode !== null) {
            lastHostComponent = stateNode;
            ;
            // Standard React on* listeners, i.e. onClick or onClickCapture
            if (reactEventName !== null) {
                const listener = getListener(instance, reactEventName);
                if (listener != null) {
                    listeners.push(createDispatchListener(instance, listener, lastHostComponent));
                }
            }
        }
        else
            ;
        // If we are only accumulating events for the target, then we don't
        // continue to propagate through the React fiber tree to find other
        // listeners.
        if (accumulateTargetOnly) {
            break;
        }
        ;
        instance = instance.return;
    }
    return listeners;
}
// We should only use this function for:
// - BeforeInputEventPlugin
// - ChangeEventPlugin
// - SelectEventPlugin
// - ScrollEndEventPlugin
// This is because we only process these plugins
// in the bubble phase, so we need to accumulate two
// phase event listeners (via emulation).
export function accumulateTwoPhaseListeners(targetFiber: Fiber | null, reactName: string): Array<DispatchListener> {
    const captureName = reactName + 'Capture';
    const listeners: Array<DispatchListener> = [];
    let instance = targetFiber;
    // Accumulate all instances and listeners via the target -> root path.
    while (instance !== null) {
        const { stateNode, tag } = instance;
        // Handle listeners that are on HostComponents (i.e. <div>)
        if ((tag === HostComponent ||
            tag === HostHoistable ||
            tag === HostSingleton) &&
            stateNode !== null) {
            const currentTarget = stateNode;
            const captureListener = getListener(instance, captureName);
            if (captureListener != null) {
                listeners.unshift(createDispatchListener(instance, captureListener, currentTarget));
            }
            const bubbleListener = getListener(instance, reactName);
            if (bubbleListener != null) {
                listeners.push(createDispatchListener(instance, bubbleListener, currentTarget));
            }
        }
        if (instance.tag === HostRoot) {
            return listeners;
        }
        instance = instance.return;
    }
    // If we didn't reach the root it means we're unmounted and shouldn't
    // dispatch any events on the target.
    return [];
}
function getParent(inst: Fiber | null): Fiber | null {
    if (inst === null) {
        return null;
    }
    do {
        inst = inst.return;
        // TODO: If this is a HostRoot we might want to bail out.
        // That is depending on if we want nested subtrees (layers) to bubble
        // events to their parent. We could also go through parentNode on the
        // host node but that wouldn't work for React Native and doesn't let us
        // do the portal feature.
    } while (inst && inst.tag !== HostComponent && inst.tag !== HostSingleton);
    if (inst) {
        return inst;
    }
    return null;
}
function accumulateEnterLeaveListenersForEvent(dispatchQueue: DispatchQueue, event: KnownReactSyntheticEvent, target: Fiber, common: Fiber | null, inCapturePhase: boolean): void {
    const registrationName = event._reactName;
    const listeners: Array<DispatchListener> = [];
    let instance: null | Fiber = target;
    while (instance !== null) {
        if (instance === common) {
            break;
        }
        const { alternate, stateNode, tag } = instance;
        if (alternate !== null && alternate === common) {
            break;
        }
        if ((tag === HostComponent ||
            tag === HostHoistable ||
            tag === HostSingleton) &&
            stateNode !== null) {
            const currentTarget = stateNode;
            if (inCapturePhase) {
                const captureListener = getListener(instance, registrationName);
                if (captureListener != null) {
                    listeners.unshift(createDispatchListener(instance, captureListener, currentTarget));
                }
            }
            else if (!inCapturePhase) {
                const bubbleListener = getListener(instance, registrationName);
                if (bubbleListener != null) {
                    listeners.push(createDispatchListener(instance, bubbleListener, currentTarget));
                }
            }
        }
        instance = instance.return;
    }
    if (listeners.length !== 0) {
        dispatchQueue.push({ event, listeners });
    }
}
// We should only use this function for:
// - EnterLeaveEventPlugin
// This is because we only process this plugin
// in the bubble phase, so we need to accumulate two
// phase event listeners.
export function accumulateEnterLeaveTwoPhaseListeners(dispatchQueue: DispatchQueue, leaveEvent: KnownReactSyntheticEvent, enterEvent: null | KnownReactSyntheticEvent, from: Fiber | null, to: Fiber | null): void {
    const common = from && to ? getLowestCommonAncestor(from, to, getParent) : null;
    if (from !== null) {
        accumulateEnterLeaveListenersForEvent(dispatchQueue, leaveEvent, from, common, false);
    }
    if (to !== null && enterEvent !== null) {
        accumulateEnterLeaveListenersForEvent(dispatchQueue, enterEvent, to, common, true);
    }
}
export function accumulateEventHandleNonManagedNodeListeners(reactEventType: DOMEventName, currentTarget: EventTarget, inCapturePhase: boolean): Array<DispatchListener> {
    const listeners: Array<DispatchListener> = [];
    const eventListeners = getEventHandlerListeners(currentTarget);
    if (eventListeners !== null) {
        eventListeners.forEach((entry) => {
            if (entry.type === reactEventType && entry.capture === inCapturePhase) {
                listeners.push(createDispatchListener(null, entry.callback, currentTarget));
            }
        });
    }
    return listeners;
}
export function getListenerSetKey(domEventName: DOMEventName, capture: boolean): string {
    return `${domEventName}__${capture ? 'capture' : 'bubble'}`;
}
