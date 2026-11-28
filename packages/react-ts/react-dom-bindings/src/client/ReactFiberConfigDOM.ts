/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import assign from 'shared/assign';
import { DomDocument, DomElement, DomNode, DomText, adoptNode, dom, flushDom, page, release, releaseTree } from 'dom-stream/dom';
import { readProperty, writeProperty, toDOMNumber, toDOMString } from 'shared/dynamicProperty';
import type { FormStatus } from 'react-dom-bindings/src/shared/ReactDOMFormActions';
import type { CrossOriginEnum,PreinitModuleScriptOptions,PreinitScriptOptions,PreinitStyleOptions,PreloadImplOptions,PreloadModuleImplOptions } from 'react-dom/src/shared/ReactDOMTypes';
import { requestFormReset as requestFormResetOnFiber } from 'react-reconciler/src/ReactFiberHooks';
import { getCurrentRootHostContainer } from 'react-reconciler/src/ReactFiberHostContext';
import { fiberIsPortaledIntoHost,getFragmentParentHostFiber,getInstanceFromHostFiber,isFiberContainedByFragment,isFiberFollowing,isFiberPreceding,isFragmentContainedByFiber,traverseFragmentInstance,traverseFragmentInstanceDeeply } from 'react-reconciler/src/ReactFiberTreeReflection';
import { flushSyncWork as flushSyncWorkOnAllRoots } from 'react-reconciler/src/ReactFiberWorkLoop';
import type { Fiber,FiberRoot } from 'react-reconciler/src/ReactInternalTypes';
import type { BoundingRect,IntersectionObserverOptions,ObserveVisibleRectsCallback } from 'react-reconciler/src/ReactTestSelectors';
import { HostComponent,HostHoistable,HostSingleton,HostText } from 'react-reconciler/src/ReactWorkTags';
import noop from 'shared/noop';
import { compareDocumentPositionForEmptyFragment } from 'shared/ReactDOMFragmentRefShared';
import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import type { ReactContext,ReactScopeInstance } from 'shared/ReactTypes';
import { listenToAllSupportedEvents } from '../events/DOMPluginEventSystem';
import { isEnabled as ReactBrowserEventEmitterIsEnabled,setEnabled as ReactBrowserEventEmitterSetEnabled } from '../events/ReactDOMEventListener';
import { retryIfBlockedOn } from '../events/ReactDOMEventReplaying';
import { NotPending } from '../shared/ReactDOMFormActions';
import { hasRole } from './DOMAccessibilityRoles';
import { MATH_NAMESPACE,SVG_NAMESPACE } from './DOMNamespaces';
import escapeSelectorAttributeValueInsideDoubleQuotes from './escapeSelectorAttributeValueInsideDoubleQuotes';
import estimateBandwidth from './estimateBandwidth';
import { COMMENT_NODE,DOCUMENT_FRAGMENT_NODE,DOCUMENT_NODE,DOCUMENT_TYPE_NODE,ELEMENT_NODE,TEXT_NODE } from './HTMLNodeType';
import { diffHydratedProperties,diffHydratedText,getPropsFromElement,hydrateProperties,hydrateText,setInitialProperties,trapClickOnNonInteractiveElement,updateProperties } from './ReactDOMComponent';
import { detachDeletedInstance,getClosestInstanceFromNode,getNodeInternals,peekNodeInternals,getInstanceFromNode as getInstanceFromNodeDOMTree,getResourcesFromRoot,isContainerMarkedAsRoot,isMarkedHoistable,isOwnedInstance,markNodeAsHoistable,precacheFiberNode,updateFiberProps } from './ReactDOMComponentTree';
import { hydrateInput } from './ReactDOMInput';
import { hydrateSelect } from './ReactDOMSelect';
import { hydrateTextarea } from './ReactDOMTextarea';
import { getSelectionInformation,restoreSelection,type SelectionInformation } from './ReactInputSelection';
import setTextContent from './setTextContent';
import type { AncestorInfoDev } from './validateDOMNesting';
export * from 'react-reconciler/src/ReactFiberConfigWithNoPersistence';
export { default as rendererVersion } from 'shared/ReactVersion';
export { getCurrentUpdatePriority,resolveUpdatePriority,setCurrentUpdatePriority } from './ReactDOMUpdatePriority';
export { detachDeletedInstance };
export { getClosestInstanceFromNode as getInstanceFromNode };
export const rendererPackageName = 'react-dom';
export const extraDevToolsConfig = null;
export type Type = string;
// The style properties React DOM reads off a style prop, as an unknown-only view of the user's style object.
type StyleView = {
    display?: unknown;
    viewTransitionName?: unknown;
    ['view-transition-name']?: unknown;
    viewTransitionClass?: unknown;
    ['view-transition-class']?: unknown;
    margin?: unknown;
    marginTop?: unknown;
    ['margin-top']?: unknown;
    marginBottom?: unknown;
    ['margin-bottom']?: unknown;
};
type PropsShape = {
    autoFocus?: boolean;
    children?: unknown;
    disabled?: boolean;
    hidden?: boolean;
    suppressHydrationWarning?: boolean;
    dangerouslySetInnerHTML?: unknown;
    style?: StyleView;
    bottom?: null | number;
    left?: null | number;
    right?: null | number;
    top?: null | number;
    is?: string;
    size?: number;
    value?: string;
    defaultValue?: string;
    checked?: boolean;
    defaultChecked?: boolean;
    multiple?: boolean;
    src?: string | Blob | MediaSource | MediaStream; // TODO: Response;
    srcSet?: string;
    loading?: 'eager' | 'lazy';
    onLoad?: (event?: unknown) => void;
};
// What React DOM reads off a host element's props, as an unknown-only view (the props are the element's own object).
export type Props = { [K in keyof PropsShape]?: unknown };
type RawProps = {
    [key: string]: unknown;
};
// The DOM bridge (packages/dom-stream): host instances are compiled nodes whose changes are written to the DOM stream and
// replayed by the page once per commit. A root container is the page's element, adopted into the bridge's node table.
export type Container = DomElement | DomDocument;
export type Instance = DomElement;
export type TextInstance = DomText;
// Comment nodes marking dehydrated boundaries. React's `_reactRetry` expando on a suspense boundary is the node
// record's `retry` (ReactDOMComponentTree).
export type ActivityInstance = DomText;
export type SuspenseInstance = DomText;
type FormStateMarkerInstance = DomText;
export type HydratableInstance = Instance | TextInstance | ActivityInstance | SuspenseInstance | FormStateMarkerInstance;
// What a ref sees: the page's own node.
export type PublicInstance = Element | Text;
export type HostContextDev = {
    context: HostContextProd;
    ancestorInfo: AncestorInfoDev;
};
type HostContextProd = HostContextNamespace;
export type HostContext = HostContextDev | HostContextProd;
export type ChildSet = undefined; // Unused
export type TimeoutHandle = number;
export type NoTimeout = -1;
export type RendererInspectionConfig = Readonly<Record<any, any>>;
export type TransitionStatus = FormStatus;
export type ViewTransitionInstance = {
    name: string;
    group: mixin.Animatable;
    imagePair: mixin.Animatable;
    old: mixin.Animatable;
    new: mixin.Animatable;
};
const SUPPRESS_HYDRATION_WARNING = 'suppressHydrationWarning';
const ACTIVITY_START_DATA = '&';
const ACTIVITY_END_DATA = '/&';
const SUSPENSE_START_DATA = '$';
const SUSPENSE_END_DATA = '/$';
const SUSPENSE_PENDING_START_DATA = '$?';
const SUSPENSE_QUEUED_START_DATA = '$~';
const SUSPENSE_FALLBACK_START_DATA = '$!';
const PREAMBLE_CONTRIBUTION_HTML = 'html';
const PREAMBLE_CONTRIBUTION_BODY = 'body';
const PREAMBLE_CONTRIBUTION_HEAD = 'head';
const FORM_STATE_IS_MATCHING = 'F!';
const FORM_STATE_IS_NOT_MATCHING = 'F';
const DOCUMENT_READY_STATE_LOADING = 'loading';
const STYLE = 'style';
type HostContextNamespace = 0 | 1 | 2;
export const HostContextNamespaceNone: HostContextNamespace = 0;
const HostContextNamespaceSvg: HostContextNamespace = 1;
const HostContextNamespaceMath: HostContextNamespace = 2;
let eventsEnabled: boolean | null | undefined = null;
let selectionInformation: null | SelectionInformation = null;
function hydrationUnsupported(): Error {
    return new Error('Hydration is not supported over the DOM bridge.');
}
function getOwnerDocumentFromRootContainer(rootContainerElement: DomNode): DomDocument {
    return rootContainerElement instanceof DomDocument
        ? rootContainerElement
        : rootContainerElement.ownerDocument!;
}
// A container's body (a document's, or an <html> container's document's): the page's element, adopted once.
function bodyOf(container: Container): DomElement {
    const doc = container instanceof DomDocument ? container : container.ownerDocument!;
    return adoptNode((page(doc) as Document).body) as DomElement;
}
export function getRootHostContext(rootContainerInstance: Container): HostContext {
    let type;
    let context: HostContextProd;
    const nodeType = rootContainerInstance.nodeType;
    switch (nodeType) {
        case DOCUMENT_NODE:
        case DOCUMENT_FRAGMENT_NODE: {
            type = nodeType === DOCUMENT_NODE ? '#document' : '#fragment';
            // A fragment has no documentElement (undefined in the JavaScript build).
            const root = nodeType === DOCUMENT_NODE ? (page(rootContainerInstance) as Document).documentElement : null;
            if (root) {
                const namespaceURI = root.namespaceURI;
                context = namespaceURI
                    ? getOwnHostContext(namespaceURI)
                    : HostContextNamespaceNone;
            }
            else {
                context = HostContextNamespaceNone;
            }
            break;
        }
        default: {
            const container = rootContainerInstance as DomElement;
            type = container.tagName;
            const namespaceURI = container.namespaceURI;
            if (!namespaceURI) {
                switch (type) {
                    case 'svg':
                        context = HostContextNamespaceSvg;
                        break;
                    case 'math':
                        context = HostContextNamespaceMath;
                        break;
                    default:
                        context = HostContextNamespaceNone;
                        break;
                }
            }
            else {
                const ownContext = getOwnHostContext(namespaceURI);
                context = getChildHostContextProd(ownContext, type);
            }
            break;
        }
    }
    ;
    return context;
}
function getOwnHostContext(namespaceURI: string): HostContextNamespace {
    switch (namespaceURI) {
        case SVG_NAMESPACE:
            return HostContextNamespaceSvg;
        case MATH_NAMESPACE:
            return HostContextNamespaceMath;
        default:
            return HostContextNamespaceNone;
    }
}
function getChildHostContextProd(parentNamespace: HostContextNamespace, type: string): HostContextNamespace {
    if (parentNamespace === HostContextNamespaceNone) {
        // No (or default) parent namespace: potential entry point.
        switch (type) {
            case 'svg':
                return HostContextNamespaceSvg;
            case 'math':
                return HostContextNamespaceMath;
            default:
                return HostContextNamespaceNone;
        }
    }
    if (parentNamespace === HostContextNamespaceSvg && type === 'foreignObject') {
        // We're leaving SVG.
        return HostContextNamespaceNone;
    }
    // By default, pass namespace below.
    return parentNamespace;
}
export function getChildHostContext(parentHostContext: HostContext, type: string): HostContext {
    ;
    const parentNamespace = (parentHostContext as HostContextProd);
    return getChildHostContextProd(parentNamespace, type);
}
// A ref sees the page's node (the stream is flushed first).
export function getPublicInstance(instance: Instance): PublicInstance {
    return page(instance) as Element;
}
// The page notes the focus and selection when it replays beginCommit, before the commit's mutations, and restores them at
// endCommit, as getSelectionInformation and restoreSelection do here in the JavaScript build (dom-stream's dom-host.js).
export function prepareForCommit(containerInfo: Container): null {
    eventsEnabled = ReactBrowserEventEmitterIsEnabled();
    dom.beginCommit(containerInfo.handle);
    const activeInstance = null;
    ;
    ReactBrowserEventEmitterSetEnabled(false);
    return activeInstance;
}
export function resetAfterCommit(containerInfo: Container): void {
    dom.endCommit(containerInfo.handle);
    flushDom();
    ReactBrowserEventEmitterSetEnabled(eventsEnabled);
    eventsEnabled = null;
}
export function createHoistableInstance(type: string, props: Props, rootContainerInstance: Container, internalInstanceHandle: Fiber): Instance {
    const ownerDocument = getOwnerDocumentFromRootContainer(rootContainerInstance);
    const domElement: Instance = ownerDocument.createElement(type);
    precacheFiberNode(internalInstanceHandle, domElement);
    updateFiberProps(domElement, props);
    setInitialProperties(domElement, type, props);
    markNodeAsHoistable(domElement);
    return domElement;
}
export function createInstance(type: string, props: Props, rootContainerInstance: Container, hostContext: HostContext, internalInstanceHandle: Fiber): Instance {
    let hostContextProd: HostContextProd;
    {
        hostContextProd = (hostContext as HostContextNamespace);
    }
    const ownerDocument = getOwnerDocumentFromRootContainer(rootContainerInstance);
    let domElement: Instance;
    switch (hostContextProd) {
        case HostContextNamespaceSvg:
            domElement = ownerDocument.createElementNS(SVG_NAMESPACE, type);
            break;
        case HostContextNamespaceMath:
            domElement = ownerDocument.createElementNS(MATH_NAMESPACE, type);
            break;
        default:
            switch (type) {
                case 'svg': {
                    domElement = ownerDocument.createElementNS(SVG_NAMESPACE, type);
                    break;
                }
                case 'math': {
                    domElement = ownerDocument.createElementNS(MATH_NAMESPACE, type);
                    break;
                }
                case 'script': {
                    // Create the script via .innerHTML so its "parser-inserted" flag is
                    // set to true and it does not execute
                    // The page makes it (a sync point: the stream is flushed first), and the bridge adopts it.
                    const div = (page(ownerDocument) as Document).createElement('div');
                    ;
                    div.innerHTML = '<script><' + '/script>';
                    // This is guaranteed to yield a script element.
                    const firstChild = (div.firstChild as HTMLScriptElement);
                    domElement = adoptNode(div.removeChild(firstChild)) as DomElement;
                    break;
                }
                case 'select': {
                    if (typeof props.is === 'string') {
                        domElement = ownerDocument.createElementIs('select', props.is);
                    }
                    else {
                        // Separate else branch instead of using `props.is || undefined` above because of a Firefox bug.
                        // See discussion in https://github.com/facebook/react/pull/6896
                        // and discussion in https://bugzilla.mozilla.org/show_bug.cgi?id=1276240
                        domElement = ownerDocument.createElement('select');
                    }
                    if (props.multiple) {
                        domElement.setPropBool('multiple', true);
                    }
                    else if (props.size) {
                        // Setting a size greater than 1 causes a select to behave like `multiple=true`, where
                        // it is possible that no option is selected.
                        //
                        // This is only necessary when a select in "single selection mode".
                        domElement.setPropNumber('size', toDOMNumber(props.size));
                    }
                    break;
                }
                default: {
                    if (typeof props.is === 'string') {
                        domElement = ownerDocument.createElementIs(type, props.is);
                    }
                    else {
                        // Separate else branch instead of using `props.is || undefined` above because of a Firefox bug.
                        // See discussion in https://github.com/facebook/react/pull/6896
                        // and discussion in https://bugzilla.mozilla.org/show_bug.cgi?id=1276240
                        domElement = ownerDocument.createElement(type);
                    }
                    ;
                }
            }
    }
    precacheFiberNode(internalInstanceHandle, domElement);
    updateFiberProps(domElement, props);
    return domElement;
}
export function cloneMutableInstance(instance: Instance, keepChildren: boolean): Instance {
    return adoptNode(page(instance).cloneNode(keepChildren)) as Instance;
}
export function appendInitialChild(parentInstance: Instance, child: Instance | TextInstance): void {
    // Note: This should not use moveBefore() because initial are appended while disconnected.
    parentInstance.appendChild(child);
}
export function finalizeInitialChildren(domElement: Instance, type: string, props: Props, hostContext: HostContext): boolean {
    setInitialProperties(domElement, type, props);
    switch (type) {
        case 'button':
        case 'input':
        case 'select':
        case 'textarea':
            return !!props.autoFocus;
        case 'img':
            return true;
        default:
            return false;
    }
}
export function finalizeHydratedChildren(domElement: Instance, type: string, props: Props, hostContext: HostContext): boolean {
    {
        return false;
    }
}
export function shouldSetTextContent(type: string, props: Props): boolean {
    return (type === 'textarea' ||
        type === 'noscript' ||
        typeof props.children === 'string' ||
        typeof props.children === 'number' ||
        typeof props.children === 'bigint' ||
        (typeof props.dangerouslySetInnerHTML === 'object' &&
            props.dangerouslySetInnerHTML !== null &&
            readProperty(props.dangerouslySetInnerHTML as object, '__html') != null));
}
export function createTextInstance(text: string, rootContainerInstance: Container, hostContext: HostContext, internalInstanceHandle: Fiber): TextInstance {
    ;
    const textNode: TextInstance = getOwnerDocumentFromRootContainer(rootContainerInstance).createTextNode(text);
    precacheFiberNode(internalInstanceHandle, textNode);
    return textNode;
}
export function cloneMutableTextInstance(textInstance: TextInstance): TextInstance {
    return adoptNode(page(textInstance).cloneNode(false)) as TextInstance;
}
let currentPopstateTransitionEvent: Event | null = null;
export function shouldAttemptEagerTransition(): boolean {
    const event = window.event;
    if (event && event.type === 'popstate') {
        // This is a popstate event. Attempt to render any transition during this
        // event synchronously. Unless we already attempted during this event.
        if (event === currentPopstateTransitionEvent) {
            // We already attempted to render this popstate transition synchronously.
            // Any subsequent attempts must have happened as the result of a derived
            // update, like startTransition inside useEffect, or useDV. Switch back to
            // the default behavior for all remaining transitions during the current
            // popstate event.
            return false;
        }
        else {
            // Cache the current event in case a derived transition is scheduled.
            // (Refer to previous branch.)
            currentPopstateTransitionEvent = event;
            return true;
        }
    }
    // We're not inside a popstate event.
    currentPopstateTransitionEvent = null;
    return false;
}
let schedulerEvent: undefined | Event = undefined;
export function resolveEventType(): null | string {
    const event = window.event;
    return event && event !== schedulerEvent ? event.type : null;
}
export function resolveEventTimeStamp(): number {
    const event = window.event;
    return event && event !== schedulerEvent ? event.timeStamp : -1.1;
}
export const isPrimaryRenderer = true;
// This initialization code may run even on server environments
// if a component just imports ReactDOM (e.g. for findDOMNode).
// Some environments might not have setTimeout or clearTimeout.
export const scheduleTimeout: typeof setTimeout = setTimeout;
export const cancelTimeout: typeof clearTimeout = clearTimeout;
export const noTimeout: -1 = -1;
export function preparePortalMount(portalInstance: Instance): void {
    listenToAllSupportedEvents(portalInstance);
}
export function prepareScopeUpdate(scopeInstance: ReactScopeInstance, internalInstanceHandle: Fiber): void {
    ;
}
export function getInstanceFromScope(scopeInstance: ReactScopeInstance): Fiber | null {
    ;
    return null;
}
// -------------------
//     Microtasks
// -------------------
export const supportsMicrotasks = true;
// One function type for every arm (the platform's queueMicrotask, the promise fallback, the timeout fallback): each arm
// is a closure of it, so no arm is adapted across function types at a call.
export const scheduleMicrotask: (callback: () => void) => void = typeof queueMicrotask === 'function'
    ? (callback: () => void) => queueMicrotask(callback)
    : typeof Promise !== 'undefined'
        ? (callback: () => void) => {
            Promise.resolve(null).then(callback).catch((error: unknown) => handleErrorInNextTick(error));
        }
        : (callback: () => void) => {
            scheduleTimeout(callback); // TODO: Determine the best fallback here.
        };
function handleErrorInNextTick(error: unknown) {
    setTimeout(() => {
        throw error;
    });
}
// -------------------
//     Mutation
// -------------------
export const supportsMutation = true;
export function commitMount(domElement: Instance, type: string, newProps: Props, internalInstanceHandle: Fiber): void {
    // Despite the naming that might imply otherwise, this method only
    // fires if there is an `Update` effect scheduled during mounting.
    // This happens if `finalizeInitialChildren` returns `true` (which it
    // does to implement the `autoFocus` attribute on the client). But
    // there are also other cases when this might happen (such as patching
    // up text content during hydration mismatch). So we'll check this again.
    switch (type) {
        case 'button':
        case 'input':
        case 'select':
        case 'textarea':
            if (newProps.autoFocus) {
                (page(domElement) as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).focus();
            }
            return;
        case 'img': {
            // The technique here is to assign the src or srcSet property to cause the browser
            // to issue a new load event. If it hasn't loaded yet it'll fire whenever the load actually completes.
            // If it has already loaded we missed it so the second load will still be the first one that executes
            // any associated onLoad props.
            // Even if we have srcSet we prefer to reassign src. The reason is that Firefox does not trigger a new
            // load event when only srcSet is assigned. Chrome will trigger a load event if either is assigned so we
            // only need to assign one. And Safari just never triggers a new load event which means this technique
            // is already a noop regardless of which properties are assigned. We should revisit if browsers update
            // this heuristic in the future.
            if (newProps.src) {
                const src = newProps.src;
                ;
                // The src setter converts to a string (a Blob or MediaSource by its toString, as here).
                domElement.setPropString('src', '' + src);
            }
            else if (newProps.srcSet) {
                domElement.setPropString('srcset', toDOMString(newProps.srcSet));
            }
            return;
        }
    }
}
export function commitHydratedInstance(domElement: Instance, type: string, props: Props, internalInstanceHandle: Fiber): void {
    {
        return;
    }
}
export function commitUpdate(domElement: Instance, type: string, oldProps: Props, newProps: Props, internalInstanceHandle: Fiber): void {
    // Diff and update the properties.
    updateProperties(domElement, type, oldProps, newProps);
    // Update the props handle so that we know which props are the ones with
    // with current event handlers.
    updateFiberProps(domElement, newProps);
}
export function resetTextContent(domElement: Instance): void {
    setTextContent(domElement, '');
}
export function commitTextUpdate(textInstance: TextInstance, oldText: string, newText: string): void {
    textInstance.setNodeValue(newText);
}
// moveBefore is off in this build (supportsMoveBefore is false): every move is an append or an insert.
export function appendChild(parentInstance: Instance, child: Instance | TextInstance): void {
    parentInstance.appendChild(child);
}
export function appendChildToContainer(container: Container, child: Instance | TextInstance): void {
    ;
    let parentNode: DomElement;
    if (container.nodeType === DOCUMENT_NODE) {
        parentNode = bodyOf(container);
    }
    else if (container.nodeName === 'HTML') {
        parentNode = bodyOf(container);
    }
    else {
        parentNode = container as DomElement;
    }
    parentNode.appendChild(child);
    // This container might be used for a portal.
    // If something inside a portal is clicked, that click should bubble
    // through the React tree. However, on Mobile Safari the click would
    // never bubble through the *DOM* tree unless an ancestor with onclick
    // event exists. So we wouldn't see it and dispatch it.
    // This is why we ensure that non React root containers have inline onclick
    // defined.
    // https://github.com/facebook/react/issues/11918
    // The onclick read is the page's (a sync point), once per container: after the trap it is set.
    const reactRootContainer = peekNodeInternals(container)?.rootContainer;
    if ((reactRootContainer === null || reactRootContainer === undefined) && !parentNode.clickTrapped &&
        (page(parentNode) as Partial<GlobalEventHandlers>).onclick === null) {
        // TODO: This cast may not be sound for SVG, MathML or custom elements.
        trapClickOnNonInteractiveElement(parentNode);
    }
}
export function insertBefore(parentInstance: Instance, child: Instance | TextInstance, beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
    parentInstance.insertBefore(child, beforeChild);
}
export function insertInContainerBefore(container: Container, child: Instance | TextInstance, beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
    ;
    let parentNode: DomElement;
    if (container.nodeType === DOCUMENT_NODE) {
        parentNode = bodyOf(container);
    }
    else if (container.nodeName === 'HTML') {
        parentNode = bodyOf(container);
    }
    else {
        parentNode = container as DomElement;
    }
    parentNode.insertBefore(child, beforeChild);
}
export function isSingletonScope(type: string): boolean {
    return type === 'head';
}
// React removes a host node only to delete it, after its subtree's unmount effects ran: the bridge releases the subtree's nodes
// (releaseTree), so neither side's node table keeps it alive.
export function removeChild(parentInstance: Instance, child: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
    parentInstance.removeChild(child);
    releaseTree(child);
}
export function removeChildFromContainer(container: Container, child: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
    let parentNode: DomElement;
    if (container.nodeType === DOCUMENT_NODE) {
        parentNode = bodyOf(container);
    }
    else if (container.nodeName === 'HTML') {
        parentNode = bodyOf(container);
    }
    else {
        parentNode = container as DomElement;
    }
    parentNode.removeChild(child);
    releaseTree(child);
}
function clearHydrationBoundary(parentInstance: Instance | DocumentFragment, hydrationInstance: SuspenseInstance | ActivityInstance): void {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function clearSuspenseBoundary(parentInstance: Instance, suspenseInstance: SuspenseInstance): void {
    clearHydrationBoundary(parentInstance, suspenseInstance);
}
function clearHydrationBoundaryFromContainer(container: Container, hydrationInstance: SuspenseInstance | ActivityInstance): void {
    let parentNode: DomElement;
    if (container.nodeType === DOCUMENT_NODE) {
        parentNode = bodyOf(container);
    }
    else if (container.nodeName === 'HTML') {
        parentNode = bodyOf(container);
    }
    else {
        parentNode = container as DomElement;
    }
    clearHydrationBoundary(parentNode, hydrationInstance);
    // Retry if any event replaying was blocked on this.
    retryIfBlockedOn(container);
}
export function clearSuspenseBoundaryFromContainer(container: Container, suspenseInstance: SuspenseInstance): void {
    clearHydrationBoundaryFromContainer(container, suspenseInstance);
}
function hideOrUnhideDehydratedBoundary(suspenseInstance: SuspenseInstance | ActivityInstance, isHidden: boolean) {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function hideDehydratedBoundary(suspenseInstance: SuspenseInstance): void {
    hideOrUnhideDehydratedBoundary(suspenseInstance, true);
}
export function hideInstance(instance: Instance): void {
    // TODO: Does this work for all element types? What about MathML? Should we
    // pass host context to this method?
    instance.style.setProperty('display', 'none', 'important');
}
export function hideTextInstance(textInstance: TextInstance): void {
    textInstance.setNodeValue('');
}
export function unhideDehydratedBoundary(dehydratedInstance: SuspenseInstance | ActivityInstance): void {
    hideOrUnhideDehydratedBoundary(dehydratedInstance, false);
}
export function unhideInstance(instance: Instance, props: Props): void {
    const styleProp = props[STYLE] as StyleView | null | undefined;
    const display = styleProp !== undefined &&
        styleProp !== null &&
        styleProp.hasOwnProperty('display')
        ? styleProp.display
        : null;
    instance.style.set('display', display == null || typeof display === 'boolean'
            ? ''
            : // The value would've errored already if it wasn't safe.
                // eslint-disable-next-line react-internal/safe-string-coercion
                ('' + display).trim());
}
export function unhideTextInstance(textInstance: TextInstance, text: string): void {
    textInstance.setNodeValue(text);
}
function warnForBlockInsideInline(instance: Element) {
    ;
}
function countClientRects(rects: ArrayLike<DOMRect>): number {
    if (rects.length === 1) {
        return 1;
    }
    // Count non-zero rects.
    let count = 0;
    for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect.width > 0 && rect.height > 0) {
            count++;
        }
    }
    return count;
}
export function applyViewTransitionName(bridgedInstance: Instance, name: string, className?: string | null): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const instance = page(bridgedInstance) as HTMLElement;
    instance.style.viewTransitionName = name;
    if (className != null) {
        instance.style.viewTransitionClass = className;
    }
    const computedStyle = getComputedStyle(instance);
    if (computedStyle.display === 'inline') {
        // WebKit has a bug where assigning a name to display: inline elements errors
        // if they have display: block children. We try to work around this bug in the
        // simple case by converting it automatically to display: inline-block.
        // https://bugs.webkit.org/show_bug.cgi?id=290923
        const rects = instance.getClientRects();
        if (countClientRects(rects) === 1) {
            // If the instance has a single client rect, that means that it can be
            // expressed as a display: inline-block or block.
            // This will cause layout thrash but we live with it since inline view transitions
            // are unusual.
            const style = instance.style;
            // If there's literally only one rect, then it's likely on a single line like an
            // inline-block. If it's multiple rects but all but one of them are empty it's
            // likely because it's a single block that caused a line break.
            style.display = rects.length === 1 ? 'inline-block' : 'block';
            // Margin doesn't apply to inline so should be zero. However, padding top/bottom
            // applies to inline-block positioning which we can offset by setting the margin
            // to the negative padding to get it back into original position.
            style.marginTop = '-' + computedStyle.paddingTop;
            style.marginBottom = '-' + computedStyle.paddingBottom;
        }
        else {
            // This case cannot be easily fixed if it has blocks but it's also fine if
            // it doesn't have blocks. So we only warn in DEV about this being an issue.
            warnForBlockInsideInline(instance);
        }
    }
}
export function restoreViewTransitionName(bridgedInstance: Instance, props: Props): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const instance = page(bridgedInstance) as HTMLElement;
    const style = instance.style;
    const styleProp = props[STYLE] as StyleView | null | undefined;
    const viewTransitionName = styleProp != null
        ? styleProp.hasOwnProperty('viewTransitionName')
            ? styleProp.viewTransitionName
            : styleProp.hasOwnProperty('view-transition-name')
                ? styleProp['view-transition-name']
                : null
        : null;
    style.viewTransitionName =
        viewTransitionName == null || typeof viewTransitionName === 'boolean'
            ? ''
            : // The value would've errored already if it wasn't safe.
                // eslint-disable-next-line react-internal/safe-string-coercion
                ('' + viewTransitionName).trim();
    const viewTransitionClass = styleProp != null
        ? styleProp.hasOwnProperty('viewTransitionClass')
            ? styleProp.viewTransitionClass
            : styleProp.hasOwnProperty('view-transition-class')
                ? styleProp['view-transition-class']
                : null
        : null;
    style.viewTransitionClass =
        viewTransitionClass == null || typeof viewTransitionClass === 'boolean'
            ? ''
            : // The value would've errored already if it wasn't safe.
                // eslint-disable-next-line react-internal/safe-string-coercion
                ('' + viewTransitionClass).trim();
    if (style.display === 'inline-block') {
        // We might have overridden the style. Reset it to what it should be.
        if (styleProp == null) {
            style.display = style.margin = '';
        }
        else {
            const display = styleProp.display;
            style.display =
                display == null || typeof display === 'boolean' ? '' : toDOMString(display);
            const margin = styleProp.margin;
            if (margin != null) {
                style.margin = toDOMString(margin);
            }
            else {
                const marginTop = styleProp.hasOwnProperty('marginTop')
                    ? styleProp.marginTop
                    : styleProp['margin-top'];
                style.marginTop =
                    marginTop == null || typeof marginTop === 'boolean' ? '' : toDOMString(marginTop);
                const marginBottom = styleProp.hasOwnProperty('marginBottom')
                    ? styleProp.marginBottom
                    : styleProp['margin-bottom'];
                style.marginBottom =
                    marginBottom == null || typeof marginBottom === 'boolean'
                        ? ''
                        : toDOMString(marginBottom);
            }
        }
    }
}
export function cancelViewTransitionName(bridgedInstance: Instance, oldName: string, props: Props): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const instance = page(bridgedInstance) as HTMLElement;
    // To cancel the "new" state and paint this instance as part of the parent, all we have to do
    // is remove the view-transition-name before we exit startViewTransition.
    restoreViewTransitionName(bridgedInstance, props);
    // There isn't a way to cancel an "old" state but what we can do is hide it by animating it.
    // Since it is already removed from the old state of the parent, this technique only works
    // if the parent also isn't transitioning. Therefore we should only cancel the root most
    // ViewTransitions.
    const documentElement = instance.ownerDocument.documentElement;
    if (documentElement !== null) {
        documentElement.animate({ opacity: [0, 0], pointerEvents: ['none', 'none'] }, {
            duration: 0,
            fill: 'forwards',
            pseudoElement: '::view-transition-group(' + oldName + ')',
        });
    }
}
export function cancelRootViewTransitionName(bridgedRootContainer: Container): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const rootContainer = page(bridgedRootContainer) as Element | Document;
    const documentElement: null | HTMLElement = rootContainer.nodeType === DOCUMENT_NODE
        ? (rootContainer as Document).documentElement
        : rootContainer.ownerDocument!.documentElement!;
    ;
    if (documentElement !== null &&
        documentElement.style.viewTransitionName === '') {
        documentElement.style.viewTransitionName = 'none';
        documentElement.animate({ opacity: [0, 0], pointerEvents: ['none', 'none'] }, {
            duration: 0,
            fill: 'forwards',
            pseudoElement: '::view-transition-group(root)',
        });
        // By default the root ::view-transition selector captures all pointer events,
        // which means nothing gets interactive. We want to let whatever is not animating
        // remain interactive during the transition. To do that, we set the size to nothing
        // so that the transition doesn't capture any clicks. We don't set pointer-events
        // on this one as that would apply to all running transitions. This lets animations
        // that are running to block clicks so that they don't end up incorrectly hitting
        // whatever is below the animation.
        documentElement.animate({ width: [0, 0], height: [0, 0] }, {
            duration: 0,
            fill: 'forwards',
            pseudoElement: '::view-transition',
        });
    }
}
export function restoreRootViewTransitionName(bridgedRootContainer: Container): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const rootContainer = page(bridgedRootContainer) as Element | Document;
    let containerInstance: HTMLElement;
    if (rootContainer.nodeType === DOCUMENT_NODE) {
        containerInstance = (rootContainer as Document).body;
    }
    else if (rootContainer.nodeName === 'HTML') {
        containerInstance = rootContainer.ownerDocument!.body;
    }
    else {
        // If the container is not the whole document, then we ideally should probably
        // clone the whole document outside of the React too.
        containerInstance = (rootContainer as HTMLElement);
    }
    ;
    if (containerInstance.style.viewTransitionName === 'root') {
        // If we moved the root view transition name to the container in a gesture
        // we need to restore it now.
        containerInstance.style.viewTransitionName = '';
    }
    const documentElement: null | HTMLElement = containerInstance.ownerDocument.documentElement;
    if (documentElement !== null &&
        documentElement.style.viewTransitionName === 'none') {
        documentElement.style.viewTransitionName = '';
    }
}
export function removeRootViewTransitionClone(bridgedRootContainer: Container, bridgedClone: Instance): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const rootContainer = page(bridgedRootContainer) as Element | Document;
    const clone = page(bridgedClone) as Element;
    let containerInstance: HTMLElement;
    if (rootContainer.nodeType === DOCUMENT_NODE) {
        containerInstance = (rootContainer as Document).body;
    }
    else if (rootContainer.nodeName === 'HTML') {
        containerInstance = rootContainer.ownerDocument!.body;
    }
    else {
        // If the container is not the whole document, then we ideally should probably
        // clone the whole document outside of the React too.
        containerInstance = (rootContainer as HTMLElement);
    }
    const containerParent = containerInstance.parentNode;
    if (containerParent === null) {
        throw new Error('Cannot use a startGestureTransition() on a detached root.');
    }
    // We assume that the clone is still within the same parent.
    containerParent.removeChild(clone);
    // Now the root is on the containerInstance itself until we call restoreRootViewTransitionName.
    containerInstance.style.viewTransitionName = 'root';
}
export type InstanceMeasurement = {
    rect: ClientRect | DOMRect;
    abs: boolean; // is absolutely positioned;
    clip: boolean; // is a clipping parent;
    view: boolean; // is in viewport bounds;
};
function createMeasurement(rect: ClientRect | DOMRect, computedStyle: CSSStyleDeclaration, element: Element): InstanceMeasurement {
    const ownerWindow = element.ownerDocument.defaultView;
    return {
        rect: rect,
        abs: 
        // Absolutely positioned instances don't contribute their size to the parent.
        computedStyle.position === 'absolute' ||
            computedStyle.position === 'fixed',
        clip: 
        // If a ViewTransition boundary acts as a clipping parent group we should
        // always mark it to animate if its children do so that we can clip them.
        // This doesn't actually have any effect yet until browsers implement
        // layered capture and nested view transitions.
        computedStyle.clipPath !== 'none' ||
            computedStyle.overflow !== 'visible' ||
            computedStyle.filter !== 'none' ||
            computedStyle.mask !== 'none' ||
            computedStyle.mask !== 'none' ||
            computedStyle.borderRadius !== '0px',
        view: 
        // If the instance was within the bounds of the viewport. We don't care as
        // much about if it was fully occluded because then it can still pop out.
        rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= ownerWindow!.innerHeight &&
            rect.left <= ownerWindow!.innerWidth,
    };
}
export function measureInstance(bridgedInstance: Instance): InstanceMeasurement {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const instance = page(bridgedInstance) as Element;
    const rect = instance.getBoundingClientRect();
    const computedStyle = getComputedStyle(instance);
    return createMeasurement(rect, computedStyle, instance);
}
export function measureClonedInstance(bridgedInstance: Instance): InstanceMeasurement {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const instance = page(bridgedInstance) as Element;
    const measuredRect = instance.getBoundingClientRect();
    // Adjust the DOMRect based on the translate that put it outside the viewport.
    // TODO: This might not be completely correct if the parent also has a transform.
    const rect = new DOMRect(measuredRect.x + 20000, measuredRect.y + 20000, measuredRect.width, measuredRect.height);
    const computedStyle = getComputedStyle(instance);
    return createMeasurement(rect, computedStyle, instance);
}
export function wasInstanceInViewport(measurement: InstanceMeasurement): boolean {
    return measurement.view;
}
export function hasInstanceChanged(oldMeasurement: InstanceMeasurement, newMeasurement: InstanceMeasurement): boolean {
    // Note: This is not guaranteed from the same instance in the case that the Instance of the
    // ViewTransition swaps out but it's still the same ViewTransition instance.
    if (newMeasurement.clip) {
        // If we're a clipping parent, we always animate if any of our children do so that we can clip
        // them. This doesn't yet until browsers implement layered capture and nested view transitions.
        return true;
    }
    const oldRect = oldMeasurement.rect;
    const newRect = newMeasurement.rect;
    return (oldRect.y !== newRect.y ||
        oldRect.x !== newRect.x ||
        oldRect.height !== newRect.height ||
        oldRect.width !== newRect.width);
}
export function hasInstanceAffectedParent(oldMeasurement: InstanceMeasurement, newMeasurement: InstanceMeasurement): boolean {
    // Note: This is not guaranteed from the same instance in the case that the Instance of the
    // ViewTransition swaps out but it's still the same ViewTransition instance.
    // If the instance has resized, it might have affected the parent layout.
    if (newMeasurement.abs) {
        // Absolutely positioned elements don't affect the parent layout, unless they
        // previously were not absolutely positioned.
        return !oldMeasurement.abs;
    }
    const oldRect = oldMeasurement.rect;
    const newRect = newMeasurement.rect;
    return oldRect.height !== newRect.height || oldRect.width !== newRect.width;
}
export type RunningViewTransition = {
    skipTransition(): void;
};

interface CustomTimeline {
    currentTime: number;
    animate(animation: Animation): undefined | (() => void);
}
export type GestureTimeline = AnimationTimeline | CustomTimeline;
type StoredEventListener = {
    type: string;
    listener: EventListener;
    optionsOrUseCapture: undefined | EventListenerOptionsOrUseCapture;
};
export type FragmentInstanceType = {
    _fragmentFiber: Fiber;
    _eventListeners: null | Array<StoredEventListener>;
    _observers: null | Set<IntersectionObserver | ResizeObserver>;
    addEventListener(type: string, listener: EventListener, optionsOrUseCapture?: EventListenerOptionsOrUseCapture): void;
    removeEventListener(type: string, listener: EventListener, optionsOrUseCapture?: EventListenerOptionsOrUseCapture): void;
    dispatchEvent(event: Event): boolean;
    focus(focusOptions?: FocusOptions): void;
    focusLast(focusOptions?: FocusOptions): void;
    blur(): void;
    observeUsing(observer: IntersectionObserver | ResizeObserver): void;
    unobserveUsing(observer: IntersectionObserver | ResizeObserver): void;
    getClientRects(): Array<DOMRect>;
    getRootNode(getRootNodeOptions?: {
        composed: boolean;
    }): Document | ShadowRoot | FragmentInstanceType;
    compareDocumentPosition(otherNode: Instance): number;
    scrollIntoView?(alignToTop?: boolean): void; // not implemented in this build (enableFragmentRefsScrollIntoView off)
};
;
export function commitNewChildToFragmentInstance(bridgedChildInstance: Instance, fragmentInstance: FragmentInstanceType): void {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const childInstance = page(bridgedChildInstance) as Element;
    const eventListeners = fragmentInstance._eventListeners;
    if (eventListeners !== null) {
        for (let i = 0; i < eventListeners.length; i++) {
            const { type, listener, optionsOrUseCapture } = eventListeners[i];
            childInstance.addEventListener(type, listener, optionsOrUseCapture);
        }
    }
    if (fragmentInstance._observers !== null) {
        fragmentInstance._observers.forEach((observer) => {
            observer.observe(childInstance);
        });
    }
}
export function clearContainer(container: Container): void {
    const nodeType = container.nodeType;
    if (nodeType === DOCUMENT_NODE) {
        // The page's own document (a sync point): React DOM's own walk over it.
        clearContainerSparingly(page(container));
    }
    else if (nodeType === ELEMENT_NODE) {
        switch (container.nodeName) {
            case 'HEAD':
            case 'HTML':
            case 'BODY':
                clearContainerSparingly(page(container));
                return;
            default: {
                (container as DomElement).setTextContent('');
            }
        }
    }
}
function clearContainerSparingly(container: Node) {
    let node;
    let nextNode: Node | null | undefined = container.firstChild;
    if (nextNode && nextNode.nodeType === DOCUMENT_TYPE_NODE) {
        nextNode = nextNode.nextSibling;
    }
    while (nextNode) {
        node = nextNode;
        nextNode = nextNode.nextSibling;
        switch (node.nodeName) {
            case 'HTML':
            case 'HEAD':
            case 'BODY': {
                const element: Element = (node as Element);
                clearContainerSparingly(element);
                // If these singleton instances had previously been rendered with React they
                // may still hold on to references to the previous fiber tree. We detatch them
                // prospectively to reset them to a baseline starting state since we cannot create
                // new instances.
                detachDeletedInstance(adoptNode(element) as Instance);
                continue;
            }
            // Script tags are retained to avoid an edge case bug. Normally scripts will execute if they
            // are ever inserted into the DOM. However when streaming if a script tag is opened but not
            // yet closed some browsers create and insert the script DOM Node but the script cannot execute
            // yet until the closing tag is parsed. If something causes React to call clearContainer while
            // this DOM node is in the document but not yet executable the DOM node will be removed from the
            // document and when the script closing tag comes in the script will not end up running. This seems
            // to happen in Chrome/Firefox but not Safari at the moment though this is not necessarily specified
            // behavior so it could change in future versions of browsers. While leaving all scripts is broader
            // than strictly necessary this is the least amount of additional code to avoid this breaking
            // edge case.
            //
            // Style tags are retained because they may likely come from 3rd party scripts and extensions
            case 'SCRIPT':
            case 'STYLE': {
                continue;
            }
            // Stylesheet tags are retained because they may likely come from 3rd party scripts and extensions
            case 'LINK': {
                if ((node as HTMLLinkElement).rel.toLowerCase() === 'stylesheet') {
                    continue;
                }
            }
        }
        container.removeChild(node);
    }
    return;
}
function clearHead(head: Element): void {
    let node = head.firstChild;
    while (node) {
        const nextNode: ChildNode | null = node.nextSibling;
        const nodeName = node.nodeName;
        if (isMarkedHoistable(node) ||
            nodeName === 'SCRIPT' ||
            nodeName === 'STYLE' ||
            (nodeName === 'LINK' &&
                (node as HTMLLinkElement).rel.toLowerCase() === 'stylesheet')) {
            // retain these nodes
        }
        else {
            head.removeChild(node);
        }
        node = nextNode;
    }
    return;
}
// -------------------
//     Hydration
// -------------------
export const supportsHydration = true;
export function canHydrateInstance(instance: HydratableInstance, type: string, props: Props, inRootOrSingleton: boolean): null | Instance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function canHydrateTextInstance(instance: HydratableInstance, text: string, inRootOrSingleton: boolean): null | TextInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
function canHydrateHydrationBoundary(instance: HydratableInstance, inRootOrSingleton: boolean): null | SuspenseInstance | ActivityInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function canHydrateActivityInstance(instance: HydratableInstance, inRootOrSingleton: boolean): null | ActivityInstance {
    const hydratableInstance = canHydrateHydrationBoundary(instance, inRootOrSingleton);
    if (hydratableInstance !== null &&
        hydratableInstance.data === ACTIVITY_START_DATA) {
        return hydratableInstance;
    }
    return null;
}
export function canHydrateSuspenseInstance(instance: HydratableInstance, inRootOrSingleton: boolean): null | SuspenseInstance {
    const hydratableInstance = canHydrateHydrationBoundary(instance, inRootOrSingleton);
    if (hydratableInstance !== null &&
        hydratableInstance.data !== ACTIVITY_START_DATA) {
        return hydratableInstance;
    }
    return null;
}
export function isSuspenseInstancePending(instance: SuspenseInstance): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function isSuspenseInstanceFallback(instance: SuspenseInstance): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getSuspenseInstanceFallbackErrorDetails(instance: SuspenseInstance): {
    digest: string | null | undefined;
    message?: string;
    stack?: string;
    componentStack?: string;
} {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function registerSuspenseInstanceRetry(instance: SuspenseInstance, callback: () => void) {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function canHydrateFormStateMarker(instance: HydratableInstance, inRootOrSingleton: boolean): null | FormStateMarkerInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function isFormStateMarkerMatching(markerInstance: FormStateMarkerInstance): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
function getNextHydratable(node: Node | null): HydratableInstance | null {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getNextHydratableSibling(instance: HydratableInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getFirstHydratableChild(parentInstance: Instance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getFirstHydratableChildWithinContainer(parentContainer: Container): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getFirstHydratableChildWithinActivityInstance(parentInstance: ActivityInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getFirstHydratableChildWithinSuspenseInstance(parentInstance: SuspenseInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
// If it were possible to have more than one scope singleton in a DOM tree
// we would need to model this as a stack but since you can only have one <head>
// and head is the only singleton that is a scope in DOM we can get away with
// tracking this as a single value.
let previousHydratableOnEnteringScopedSingleton: null | HydratableInstance = null;
export function getFirstHydratableChildWithinSingleton(type: string, singletonInstance: Instance, currentHydratableInstance: null | HydratableInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getNextHydratableSiblingAfterSingleton(type: string, currentHydratableInstance: null | HydratableInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function describeHydratableInstanceForDevWarnings(instance: HydratableInstance): null | string | {
    type: string;
    props: Readonly<Props>;
} {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function validateHydratableInstance(type: string, props: Props, hostContext: HostContext): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function hydrateInstance(instance: Instance, type: string, props: Props, hostContext: HostContext, internalInstanceHandle: Fiber): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
// Returns a Map of properties that were different on the server.
export function diffHydratedPropsForDevWarnings(instance: Instance, type: string, props: Props, hostContext: HostContext): null | Readonly<Props> {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function validateHydratableTextInstance(text: string, hostContext: HostContext): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function hydrateTextInstance(textInstance: TextInstance, text: string, internalInstanceHandle: Fiber, parentInstanceProps: null | Props): boolean {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
// Returns the server text if it differs from the client.
export function diffHydratedTextForDevWarnings(textInstance: TextInstance, text: string, parentProps: null | Props): null | string {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function hydrateActivityInstance(activityInstance: ActivityInstance, internalInstanceHandle: Fiber) {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function hydrateSuspenseInstance(suspenseInstance: SuspenseInstance, internalInstanceHandle: Fiber) {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
function getNextHydratableInstanceAfterHydrationBoundary(hydrationInstance: SuspenseInstance | ActivityInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getNextHydratableInstanceAfterActivityInstance(activityInstance: ActivityInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
export function getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance: SuspenseInstance): null | HydratableInstance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
// Returns the SuspenseInstance if this node is a direct child of a
// SuspenseInstance. I.e. if its previous sibling is a Comment with
// SUSPENSE_x_START_DATA. Otherwise, null.
// Over the bridge's own tree: a boundary is a comment node the bridge made, its text the comment's data.
export function getParentHydrationBoundary(targetInstance: DomNode): null | SuspenseInstance | ActivityInstance {
    let node = targetInstance.previousSibling;
    // Skip past all nodes within this suspense boundary.
    // There might be nested nodes so we need to keep track of how
    // deep we are and only break out when we're back on top.
    let depth = 0;
    while (node) {
        if (node.nodeType === COMMENT_NODE && node instanceof DomText) {
            const data = node.data;
            if (data === SUSPENSE_START_DATA ||
                data === SUSPENSE_FALLBACK_START_DATA ||
                data === SUSPENSE_PENDING_START_DATA ||
                data === SUSPENSE_QUEUED_START_DATA ||
                data === ACTIVITY_START_DATA) {
                if (depth === 0) {
                    return node;
                }
                else {
                    depth--;
                }
            }
            else if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
                depth++;
            }
        }
        node = node.previousSibling;
    }
    return null;
}
export function commitHydratedContainer(container: Container): void {
    // Retry if any event replaying was blocked on this.
    retryIfBlockedOn(container);
}
export function commitHydratedActivityInstance(activityInstance: ActivityInstance): void {
    // Retry if any event replaying was blocked on this.
    retryIfBlockedOn(activityInstance);
}
export function commitHydratedSuspenseInstance(suspenseInstance: SuspenseInstance): void {
    // Retry if any event replaying was blocked on this.
    retryIfBlockedOn(suspenseInstance);
}
export function flushHydrationEvents(): void {
    ;
}
export function shouldDeleteUnhydratedTailInstances(parentType: string): boolean {
    return parentType !== 'form' && parentType !== 'button';
}
// -------------------
//     Test Selectors
// -------------------
export const supportsTestSelectors = true;
// The HostRoot fiber of the first container found (React's Flow type says FiberRoot; the caller reads its stateNode).
// Over the page's own tree (a test selector: a sync point).
export function findFiberRoot(node: Instance): null | Fiber {
    const stack: Element[] = [page(node) as Element];
    let index = 0;
    while (index < stack.length) {
        const current = stack[index++];
        if (isContainerMarkedAsRoot(current)) {
            return getInstanceFromNodeDOMTree(current);
        }
        stack.push(...current.children);
    }
    return null;
}
export function getBoundingRect(bridgedNode: Instance): BoundingRect {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const node = page(bridgedNode) as Element;
    const rect = node.getBoundingClientRect();
    return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
    };
}
export function matchAccessibilityRole(node: Instance, role: string): boolean {
    if (hasRole(page(node) as Element, role)) {
        return true;
    }
    return false;
}
export function getTextContent(fiber: Fiber): string | null {
    switch (fiber.tag) {
        case HostHoistable:
        case HostSingleton:
        case HostComponent:
            let textContent = '';
            const childNodes = fiber.stateNode.childNodes;
            for (let i = 0; i < childNodes.length; i++) {
                const childNode = childNodes[i];
                if (childNode.nodeType === Node.TEXT_NODE) {
                    textContent += childNode.textContent;
                }
            }
            return textContent;
        case HostText:
            return fiber.stateNode.textContent;
    }
    return null;
}
export function isHiddenSubtree(fiber: Fiber): boolean {
    return fiber.tag === HostComponent && fiber.memoizedProps.hidden === true;
}
export function setFocusIfFocusable(node: Instance, focusOptions?: FocusOptions): boolean {
    // The logic for determining if an element is focusable is kind of complex,
    // and since we want to actually change focus anyway- we can just skip it.
    // Instead we'll just listen for a "focus" event to verify that focus was set.
    //
    // We could compare the node to document.activeElement after focus,
    // but this would not handle the case where application code managed focus to automatically blur.
    let didFocus = false;
    const handleFocus = () => {
        didFocus = true;
    };
    const element = (page(node) as HTMLElement);
    try {
        element.addEventListener('focus', handleFocus);
        (element.focus || HTMLElement.prototype.focus).call(element, focusOptions);
    }
    finally {
        element.removeEventListener('focus', handleFocus);
    }
    return didFocus;
}
type RectRatio = {
    ratio: number;
    rect: BoundingRect;
};
export function setupIntersectionObserver(targets: Array<Instance>, callback: ObserveVisibleRectsCallback, options?: IntersectionObserverOptions): {
    disconnect: () => void;
    observe: (instance: Instance) => void;
    unobserve: (instance: Instance) => void;
} {
    // Keyed by the page's elements, as the observer's entries name them.
    const rectRatioCache: Map<Element, RectRatio> = new Map();
    targets.forEach((target) => {
        rectRatioCache.set(page(target) as Element, {
            rect: getBoundingRect(target),
            ratio: 0,
        });
    });
    const handleIntersection = (entries: Array<IntersectionObserverEntry>) => {
        entries.forEach((entry) => {
            const { boundingClientRect, intersectionRatio, target } = entry;
            rectRatioCache.set(target, {
                rect: {
                    x: boundingClientRect.left,
                    y: boundingClientRect.top,
                    width: boundingClientRect.width,
                    height: boundingClientRect.height,
                },
                ratio: intersectionRatio,
            });
        });
        callback(Array.from(rectRatioCache.values()));
    };
    const observer = new IntersectionObserver(handleIntersection, options);
    targets.forEach((target) => {
        observer.observe(page(target) as Element);
    });
    return {
        disconnect: () => observer.disconnect(),
        observe: (target) => {
            rectRatioCache.set(page(target) as Element, {
                rect: getBoundingRect(target),
                ratio: 0,
            });
            observer.observe(page(target) as Element);
        },
        unobserve: (target) => {
            rectRatioCache.delete(page(target) as Element);
            observer.unobserve(page(target) as Element);
        },
    };
}
// -------------------
//     Singletons
// -------------------
export const supportsSingletons = true;
export function isHostSingletonType(type: string): boolean {
    return type === 'html' || type === 'head' || type === 'body';
}
export function resolveSingletonInstance(type: string, props: Props, rootContainerInstance: Container, hostContext: HostContext, validateDOMNestingDev: boolean): Instance {
    ;
    // The page's document (a sync point); the singleton it answers is adopted.
    const ownerDocument = page(getOwnerDocumentFromRootContainer(rootContainerInstance)) as Document;
    switch (type) {
        case 'html': {
            const documentElement = ownerDocument.documentElement;
            if (!documentElement) {
                throw new Error('React expected an <html> element (document.documentElement) to exist in the Document but one was' +
                    ' not found. React never removes the documentElement for any Document it renders into so' +
                    ' the cause is likely in some other script running on this page.');
            }
            return adoptNode(documentElement) as Instance;
        }
        case 'head': {
            const head = ownerDocument.head;
            if (!head) {
                throw new Error('React expected a <head> element (document.head) to exist in the Document but one was' +
                    ' not found. React never removes the head for any Document it renders into so' +
                    ' the cause is likely in some other script running on this page.');
            }
            return adoptNode(head) as Instance;
        }
        case 'body': {
            const body = ownerDocument.body;
            if (!body) {
                throw new Error('React expected a <body> element (document.body) to exist in the Document but one was' +
                    ' not found. React never removes the body for any Document it renders into so' +
                    ' the cause is likely in some other script running on this page.');
            }
            return adoptNode(body) as Instance;
        }
        default: {
            throw new Error('resolveSingletonInstance was called with an element type that is not supported. This is a bug in React.');
        }
    }
}
export function acquireSingletonInstance(type: string, props: Props, instance: Instance, internalInstanceHandle: Fiber): void {
    ;
    // The page's element (a sync point) loses its attributes; the new ones go through the bridge.
    const element = page(instance) as Element;
    const attributes = element.attributes;
    while (attributes.length) {
        element.removeAttributeNode(attributes[0]);
    }
    setInitialProperties(instance, type, props);
    precacheFiberNode(internalInstanceHandle, instance);
    updateFiberProps(instance, props);
}
export function releaseSingletonInstance(instance: Instance): void {
    const element = page(instance) as Element;
    const attributes = element.attributes;
    while (attributes.length) {
        element.removeAttributeNode(attributes[0]);
    }
    detachDeletedInstance(instance);
}
// -------------------
//     Resources
// -------------------
export const supportsResources = true;
// React DOM's initial properties on a page element the resource code made: the element is adopted into the bridge, its properties
// go through the stream, and the stream is flushed, so the page sees them before the element is inserted.
function setInitialPropertiesOnPage(element: Element, tag: string, props: Record<any, any>): void {
    setInitialProperties(adoptNode(element) as DomElement, tag, props);
    flushDom();
}
type HoistableTagType = 'link' | 'meta' | 'title';
// A resource's element is the page's own: resources are found, inserted and listened to in the page's head (a sync point each).
type TResource<T extends 'stylesheet' | 'style' | 'script' | 'void', S extends null | Record<any, any>> = {
    type: T;
    instance: null | Element;
    count: number;
    state: S;
};
type StylesheetResource = TResource<'stylesheet', StylesheetState>;
type StyleTagResource = TResource<'style', null>;
type StyleResource = StyleTagResource | StylesheetResource;
type ScriptResource = TResource<'script', null>;
type VoidResource = TResource<'void', null>;
export type Resource = StyleResource | ScriptResource | VoidResource;
type LoadingState = number;
const NotLoaded = /*       */ 0b000;
const Loaded = /*          */ 0b001;
const Errored = /*         */ 0b010;
const Settled = /*         */ 0b011;
const Inserted = /*        */ 0b100;
type StylesheetState = {
    loading: LoadingState;
    preload: null | HTMLLinkElement;
};
// Hoistable element props: open-ended bags React builds by copying and setting keys, and iterates in insertion order
// to set the element's attributes (string-keyed records; the keys React sets are read with their expected types).
type PropBag = {
    [key: string]: unknown;
};
type StyleTagProps = PropBag;
type StylesheetProps = PropBag;
type ScriptProps = PropBag;
type PreloadProps = PropBag;
type PreloadModuleProps = PropBag;
export type RootResources = {
    hoistableStyles: Map<string, StyleResource>;
    hoistableScripts: Map<string, ScriptResource>;
};
export function prepareToCommitHoistables() {
    tagCaches = null;
}
// global collections of Resources
const preloadPropsMap: Map<string, PreloadProps | PreloadModuleProps> = new Map();
const preconnectsSet: Set<string> = new Set();
export type HoistableRoot = Document | ShadowRoot;
// getRootNode is missing from IE and old jsdom versions
export function getHoistableRoot(bridgedContainer: Container): HoistableRoot {
    // The page's own node (a sync point): this path runs React DOM's own DOM code on it.
    const container = page(bridgedContainer) as Element | Document;
    return typeof container.getRootNode === 'function'
        ?
            (container.getRootNode() as Document | ShadowRoot)
        : container.nodeType === DOCUMENT_NODE
            ?
                (container as Document)
            : container.ownerDocument!;
}
function getCurrentResourceRoot(): null | HoistableRoot {
    const currentContainer = getCurrentRootHostContainer();
    return currentContainer ? getHoistableRoot(currentContainer) : null;
}
function getDocumentFromRoot(root: HoistableRoot): Document {
    return root.ownerDocument || root;
}
const previousDispatcher = ReactDOMSharedInternals.d; /* ReactDOMCurrentDispatcher */
ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */ = {
    f /* flushSyncWork */: flushSyncWork /* flushSyncWork */,
    r: requestFormReset,
    D /* prefetchDNS */: prefetchDNS,
    C /* preconnect */: preconnect,
    L /* preload */: preload,
    m /* preloadModule */: preloadModule,
    X /* preinitScript */: preinitScript,
    S /* preinitStyle */: preinitStyle,
    M /* preinitModuleScript */: preinitModuleScript,
};
function flushSyncWork() {
    {
        const previousWasRendering = previousDispatcher.f(); /* flushSyncWork */
        const wasRendering = flushSyncWorkOnAllRoots();
        // Since multiple dispatchers can flush sync work during a single flushSync call
        // we need to return true if any of them were rendering.
        return previousWasRendering || wasRendering;
    }
}
function requestFormReset(form: HTMLFormElement) {
    const formInst = getInstanceFromNodeDOMTree(form);
    if (formInst !== null &&
        formInst.tag === HostComponent &&
        formInst.type === 'form') {
        requestFormResetOnFiber(formInst);
    }
    else {
        // This form was either not rendered by this React renderer (or it's an
        // invalid type). Try the next one.
        //
        // The last implementation in the sequence will throw an error.
        previousDispatcher.r(/* requestFormReset */ form);
    }
}
// We expect this to get inlined. It is a function mostly to communicate the special nature of
// how we resolve the HoistableRoot for ReactDOM.pre*() methods. Because we support calling
// these methods outside of render there is no way to know which Document or ShadowRoot is 'scoped'
// and so we have to fall back to something universal. Currently we just refer to the global document.
// This is notable because nowhere else in ReactDOM do we actually reference the global document or window
// because we may be rendering inside an iframe.
const globalDocument = typeof document === 'undefined' ? null : document;
function getGlobalDocument(): Document | null | undefined {
    return globalDocument;
}
function preconnectAs(rel: 'preconnect' | 'dns-prefetch', href: string, crossOrigin?: CrossOriginEnum | null) {
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && typeof href === 'string' && href) {
        const limitedEscapedHref = escapeSelectorAttributeValueInsideDoubleQuotes(href);
        let key = `link[rel="${rel}"][href="${limitedEscapedHref}"]`;
        if (typeof crossOrigin === 'string') {
            key += `[crossorigin="${crossOrigin}"]`;
        }
        if (!preconnectsSet.has(key)) {
            preconnectsSet.add(key);
            const preconnectProps = { rel, crossOrigin, href } as const;
            if (null === ownerDocument.querySelector(key)) {
                const instance = ownerDocument.createElement('link');
                setInitialPropertiesOnPage(instance, 'link', preconnectProps);
                markNodeAsHoistable(instance);
                (ownerDocument.head).appendChild(instance);
            }
        }
    }
}
function prefetchDNS(href: string) {
    previousDispatcher.D(/* prefetchDNS */ href);
    preconnectAs('dns-prefetch', href, null);
}
function preconnect(href: string, crossOrigin?: CrossOriginEnum | null) {
    previousDispatcher.C(/* preconnect */ href, crossOrigin);
    preconnectAs('preconnect', href, crossOrigin);
}
function preload(href: string, as: string, options?: PreloadImplOptions | null) {
    previousDispatcher.L(/* preload */ href, as, options);
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && href && as) {
        let preloadSelector = `link[rel="preload"][as="${escapeSelectorAttributeValueInsideDoubleQuotes(as)}"]`;
        if (as === 'image') {
            if (options && options.imageSrcSet) {
                preloadSelector += `[imagesrcset="${escapeSelectorAttributeValueInsideDoubleQuotes(options.imageSrcSet)}"]`;
                if (typeof options.imageSizes === 'string') {
                    preloadSelector += `[imagesizes="${escapeSelectorAttributeValueInsideDoubleQuotes(options.imageSizes)}"]`;
                }
            }
            else {
                preloadSelector += `[href="${escapeSelectorAttributeValueInsideDoubleQuotes(href)}"]`;
            }
        }
        else {
            preloadSelector += `[href="${escapeSelectorAttributeValueInsideDoubleQuotes(href)}"]`;
        }
        // Some preloads are keyed under their selector. This happens when the preload is for
        // an arbitrary type. Other preloads are keyed under the resource key they represent a preload for.
        // Here we figure out which key to use to determine if we have a preload already.
        let key = preloadSelector;
        switch (as) {
            case 'style':
                key = getStyleKey(href);
                break;
            case 'script':
                key = getScriptKey(href);
                break;
        }
        if (!preloadPropsMap.has(key)) {
            const preloadProps = Object.assign(({
                rel: 'preload',
                // There is a bug in Safari where imageSrcSet is not respected on preload links
                // so we omit the href here if we have imageSrcSet b/c safari will load the wrong image.
                // This harms older browers that do not support imageSrcSet by making their preloads not work
                // but this population is shrinking fast and is already small so we accept this tradeoff.
                href: as === 'image' && options && options.imageSrcSet ? undefined : href,
                as,
            } as PreloadProps), options);
            preloadPropsMap.set(key, preloadProps);
            if (null === ownerDocument.querySelector(preloadSelector)) {
                if (as === 'style' &&
                    ownerDocument.querySelector(getStylesheetSelectorFromKey(key))) {
                    // We already have a stylesheet for this key. We don't need to preload it.
                    return;
                }
                else if (as === 'script' &&
                    ownerDocument.querySelector(getScriptSelectorFromKey(key))) {
                    // We already have a stylesheet for this key. We don't need to preload it.
                    return;
                }
                const instance = ownerDocument.createElement('link');
                setInitialPropertiesOnPage(instance, 'link', preloadProps);
                markNodeAsHoistable(instance);
                (ownerDocument.head).appendChild(instance);
            }
        }
    }
}
function preloadModule(href: string, options?: PreloadModuleImplOptions | null) {
    previousDispatcher.m(/* preloadModule */ href, options);
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && href) {
        const as = options && typeof options.as === 'string' ? options.as : 'script';
        const preloadSelector = `link[rel="modulepreload"][as="${escapeSelectorAttributeValueInsideDoubleQuotes(as)}"][href="${escapeSelectorAttributeValueInsideDoubleQuotes(href)}"]`;
        // Some preloads are keyed under their selector. This happens when the preload is for
        // an arbitrary type. Other preloads are keyed under the resource key they represent a preload for.
        // Here we figure out which key to use to determine if we have a preload already.
        let key = preloadSelector;
        switch (as) {
            case 'audioworklet':
            case 'paintworklet':
            case 'serviceworker':
            case 'sharedworker':
            case 'worker':
            case 'script': {
                key = getScriptKey(href);
                break;
            }
        }
        if (!preloadPropsMap.has(key)) {
            const props: PreloadModuleProps = Object.assign(({
                rel: 'modulepreload',
                href,
            } as PreloadModuleProps), options);
            preloadPropsMap.set(key, props);
            if (null === ownerDocument.querySelector(preloadSelector)) {
                switch (as) {
                    case 'audioworklet':
                    case 'paintworklet':
                    case 'serviceworker':
                    case 'sharedworker':
                    case 'worker':
                    case 'script': {
                        if (ownerDocument.querySelector(getScriptSelectorFromKey(key))) {
                            return;
                        }
                    }
                }
                const instance = ownerDocument.createElement('link');
                setInitialPropertiesOnPage(instance, 'link', props);
                markNodeAsHoistable(instance);
                (ownerDocument.head).appendChild(instance);
            }
        }
    }
}
function preinitStyle(href: string, precedence?: string | null, options?: PreinitStyleOptions | null) {
    previousDispatcher.S(/* preinitStyle */ href, precedence, options);
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && href) {
        const styles = getResourcesFromRoot(ownerDocument).hoistableStyles;
        const key = getStyleKey(href);
        precedence = precedence || 'default';
        // Check if this resource already exists
        let resource = styles.get(key);
        if (resource) {
            // We can early return. The resource exists and there is nothing
            // more to do
            return;
        }
        const state: StylesheetState = {
            loading: NotLoaded,
            preload: null,
        };
        // Attempt to hydrate instance from DOM
        let instance: null | Element = ownerDocument.querySelector(getStylesheetSelectorFromKey(key));
        if (instance) {
            state.loading = Loaded | Inserted;
        }
        else {
            // Construct a new instance and insert it
            const stylesheetProps = Object.assign(({
                rel: 'stylesheet',
                href,
                'data-precedence': precedence,
            } as StylesheetProps), options);
            const preloadProps = preloadPropsMap.get(key);
            if (preloadProps) {
                adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
            }
            const link = (instance = ownerDocument.createElement('link'));
            markNodeAsHoistable(link);
            setInitialPropertiesOnPage(link, 'link', stylesheetProps);
            getNodeInternals(link).loadingPromise = new Promise<Event>((resolve, reject) => {
                link.onload = resolve;
                link.onerror = reject;
            });
            link.addEventListener('load', () => {
                state.loading |= Loaded;
            });
            link.addEventListener('error', () => {
                state.loading |= Errored;
            });
            state.loading |= Inserted;
            insertStylesheet(instance, precedence, ownerDocument);
        }
        // Construct a Resource and cache it
        resource = {
            type: 'stylesheet',
            instance,
            count: 1,
            state,
        };
        styles.set(key, resource);
        return;
    }
}
function preinitScript(src: string, options?: PreinitScriptOptions | null) {
    previousDispatcher.X(/* preinitScript */ src, options);
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && src) {
        const scripts = getResourcesFromRoot(ownerDocument).hoistableScripts;
        const key = getScriptKey(src);
        // Check if this resource already exists
        let resource = scripts.get(key);
        if (resource) {
            // We can early return. The resource exists and there is nothing
            // more to do
            return;
        }
        // Attempt to hydrate instance from DOM
        let instance: null | Element = ownerDocument.querySelector(getScriptSelectorFromKey(key));
        if (!instance) {
            // Construct a new instance and insert it
            const scriptProps = Object.assign(({
                src,
                async: true,
            } as ScriptProps), options);
            // Adopt certain preload props
            const preloadProps = preloadPropsMap.get(key);
            if (preloadProps) {
                adoptPreloadPropsForScript(scriptProps, preloadProps);
            }
            instance = ownerDocument.createElement('script');
            markNodeAsHoistable(instance);
            setInitialPropertiesOnPage(instance, 'link', scriptProps);
            (ownerDocument.head).appendChild(instance);
        }
        // Construct a Resource and cache it
        resource = {
            type: 'script',
            instance,
            count: 1,
            state: null,
        };
        scripts.set(key, resource);
        return;
    }
}
function preinitModuleScript(src: string, options?: PreinitModuleScriptOptions | null) {
    previousDispatcher.M(/* preinitModuleScript */ src, options);
    const ownerDocument = getGlobalDocument();
    if (ownerDocument && src) {
        const scripts = getResourcesFromRoot(ownerDocument).hoistableScripts;
        const key = getScriptKey(src);
        // Check if this resource already exists
        let resource = scripts.get(key);
        if (resource) {
            // We can early return. The resource exists and there is nothing
            // more to do
            return;
        }
        // Attempt to hydrate instance from DOM
        let instance: null | Element = ownerDocument.querySelector(getScriptSelectorFromKey(key));
        if (!instance) {
            // Construct a new instance and insert it
            const scriptProps = Object.assign(({
                src,
                async: true,
                type: 'module',
            } as ScriptProps), options);
            // Adopt certain preload props
            const preloadProps = preloadPropsMap.get(key);
            if (preloadProps) {
                adoptPreloadPropsForScript(scriptProps, preloadProps);
            }
            instance = ownerDocument.createElement('script');
            markNodeAsHoistable(instance);
            setInitialPropertiesOnPage(instance, 'link', scriptProps);
            (ownerDocument.head).appendChild(instance);
        }
        // Construct a Resource and cache it
        resource = {
            type: 'script',
            instance,
            count: 1,
            state: null,
        };
        scripts.set(key, resource);
        return;
    }
}
type StyleTagQualifyingProps = {
    href: string;
    precedence: string;
    [key: string]: unknown;
};
type StylesheetQualifyingProps = {
    rel: 'stylesheet';
    href: string;
    precedence: string;
    [key: string]: unknown;
};
// This function is called in begin work and we should always have a currentDocument set
export function getResource(type: string, currentProps: unknown, pendingProps: any, currentResource: null | Resource): null | Resource {
    const resourceRoot = getCurrentResourceRoot();
    if (!resourceRoot) {
        throw new Error('"resourceRoot" was expected to exist. This is a bug in React.');
    }
    switch (type) {
        case 'meta':
        case 'title': {
            return null;
        }
        case 'style': {
            if (typeof pendingProps.precedence === 'string' &&
                typeof pendingProps.href === 'string') {
                const key = getStyleKey(pendingProps.href);
                const styles = getResourcesFromRoot(resourceRoot).hoistableStyles;
                let resource = styles.get(key);
                if (!resource) {
                    resource = {
                        type: 'style',
                        instance: null,
                        count: 0,
                        state: null,
                    };
                    styles.set(key, resource);
                }
                return resource;
            }
            return {
                type: 'void',
                instance: null,
                count: 0,
                state: null,
            };
        }
        case 'link': {
            if (pendingProps.rel === 'stylesheet' &&
                typeof pendingProps.href === 'string' &&
                typeof pendingProps.precedence === 'string') {
                const qualifiedProps: StylesheetQualifyingProps = pendingProps;
                const key = getStyleKey(qualifiedProps.href);
                const styles = getResourcesFromRoot(resourceRoot).hoistableStyles;
                let resource = styles.get(key);
                if (!resource) {
                    // We asserted this above but Flow can't figure out that the type satisfies
                    const ownerDocument = getDocumentFromRoot(resourceRoot);
                    resource = ({
                        type: 'stylesheet',
                        instance: null,
                        count: 0,
                        state: {
                            loading: NotLoaded,
                            preload: null,
                        },
                    } as StylesheetResource);
                    styles.set(key, resource);
                    const instance = ownerDocument.querySelector(getStylesheetSelectorFromKey(key));
                    if (instance) {
                        const loadingState: Promise<Event> | null | undefined = peekNodeInternals(instance)?.loadingPromise;
                        if (loadingState) {
                            // This instance is inserted as part of a boundary reveal and is not yet
                            // loaded
                        }
                        else {
                            // This instance is already loaded
                            resource.instance = instance;
                            resource.state.loading = Loaded | Inserted;
                        }
                    }
                    if (!preloadPropsMap.has(key)) {
                        const preloadProps = preloadPropsFromStylesheet(qualifiedProps);
                        preloadPropsMap.set(key, preloadProps);
                        if (!instance) {
                            preloadStylesheet(ownerDocument, key, preloadProps, resource.state);
                        }
                    }
                }
                if (currentProps && currentResource === null) {
                    // This node was previously an Instance type and is becoming a Resource type
                    // For now we error because we don't support flavor changes
                    let diff = '';
                    ;
                    throw new Error('Expected <link> not to update to be updated to a stylesheet with precedence.' +
                        ' Check the `rel`, `href`, and `precedence` props of this component.' +
                        ' Alternatively, check whether two different <link> components render in the same slot or share the same key.' +
                        diff);
                }
                return resource;
            }
            else {
                if (currentProps && currentResource !== null) {
                    // This node was previously a Resource type and is becoming an Instance type
                    // For now we error because we don't support flavor changes
                    let diff = '';
                    ;
                    throw new Error('Expected stylesheet with precedence to not be updated to a different kind of <link>.' +
                        ' Check the `rel`, `href`, and `precedence` props of this component.' +
                        ' Alternatively, check whether two different <link> components render in the same slot or share the same key.' +
                        diff);
                }
                return null;
            }
        }
        case 'script': {
            const async = pendingProps.async;
            const src = pendingProps.src;
            if (typeof src === 'string' &&
                async &&
                typeof async !== 'function' &&
                typeof async !== 'symbol') {
                const key = getScriptKey(src);
                const scripts = getResourcesFromRoot(resourceRoot).hoistableScripts;
                let resource = scripts.get(key);
                if (!resource) {
                    resource = {
                        type: 'script',
                        instance: null,
                        count: 0,
                        state: null,
                    };
                    scripts.set(key, resource);
                }
                return resource;
            }
            return {
                type: 'void',
                instance: null,
                count: 0,
                state: null,
            };
        }
        default: {
            throw new Error(`getResource encountered a type it did not expect: "${type}". this is a bug in React.`);
        }
    }
}
// React spreads the props into a literal and sets these keys after; copying then setting gives the same keys in the
// same order.
function styleTagPropsFromRawProps(rawProps: StyleTagQualifyingProps): StyleTagProps {
    const props: StyleTagProps = {};
    assign(props, rawProps);
    writeProperty(props, 'data-href', rawProps.href);
    writeProperty(props, 'data-precedence', rawProps.precedence);
    writeProperty(props, 'href', null);
    writeProperty(props, 'precedence', null);
    return props;
}
function getStyleKey(href: string) {
    const limitedEscapedHref = escapeSelectorAttributeValueInsideDoubleQuotes(href);
    return `href="${limitedEscapedHref}"`;
}
function getStyleTagSelector(href: string) {
    const limitedEscapedHref = escapeSelectorAttributeValueInsideDoubleQuotes(href);
    return `style[data-href~="${limitedEscapedHref}"]`;
}
function getStylesheetSelectorFromKey(key: string) {
    return `link[rel="stylesheet"][${key}]`;
}
function getPreloadStylesheetSelectorFromKey(key: string) {
    return `link[rel="preload"][as="style"][${key}]`;
}
function stylesheetPropsFromRawProps(rawProps: StylesheetQualifyingProps): StylesheetProps {
    const props: StylesheetProps = {};
    assign(props, rawProps);
    writeProperty(props, 'data-precedence', rawProps.precedence);
    writeProperty(props, 'precedence', null);
    return props;
}
function preloadStylesheet(ownerDocument: Document, key: string, preloadProps: PreloadProps, state: StylesheetState) {
    const preloadEl = ownerDocument.querySelector(getPreloadStylesheetSelectorFromKey(key));
    if (preloadEl) {
        // If we find a preload already it was SSR'd and we won't have an actual
        // loading state to track. For now we will just assume it is loaded
        state.loading = Loaded;
    }
    else {
        const instance = ownerDocument.createElement('link');
        state.preload = instance;
        instance.addEventListener('load', () => (state.loading |= Loaded));
        instance.addEventListener('error', () => (state.loading |= Errored));
        setInitialPropertiesOnPage(instance, 'link', preloadProps);
        markNodeAsHoistable(instance);
        (ownerDocument.head).appendChild(instance);
    }
}
function preloadPropsFromStylesheet(props: StylesheetQualifyingProps): PreloadProps {
    return {
        rel: 'preload',
        as: 'style',
        href: props.href,
        crossOrigin: props.crossOrigin,
        integrity: props.integrity,
        media: props.media,
        hrefLang: props.hrefLang,
        referrerPolicy: props.referrerPolicy,
    };
}
function getScriptKey(src: string): string {
    const limitedEscapedSrc = escapeSelectorAttributeValueInsideDoubleQuotes(src);
    return `[src="${limitedEscapedSrc}"]`;
}
function getScriptSelectorFromKey(key: string): string {
    return 'script[async]' + key;
}
// The fiber's state node for a resource is the bridge's node for the resource's page element (adopted).
export function acquireResource(hoistableRoot: HoistableRoot, resource: Resource, props: any): null | Instance {
    const element = acquireResourceOnPage(hoistableRoot, resource, props);
    return element === null ? null : adoptNode(element) as Instance;
}
function acquireResourceOnPage(hoistableRoot: HoistableRoot, resource: Resource, props: any): null | Element {
    resource.count++;
    if (resource.instance === null) {
        switch (resource.type) {
            case 'style': {
                const qualifiedProps: StyleTagQualifyingProps = props;
                // Attempt to hydrate instance from DOM
                let instance: null | Element = hoistableRoot.querySelector(getStyleTagSelector(qualifiedProps.href));
                if (instance) {
                    resource.instance = instance;
                    markNodeAsHoistable(instance);
                    return instance;
                }
                const styleProps = styleTagPropsFromRawProps(props);
                const ownerDocument = getDocumentFromRoot(hoistableRoot);
                instance = ownerDocument.createElement('style');
                markNodeAsHoistable(instance);
                setInitialPropertiesOnPage(instance, 'style', styleProps);
                // TODO: `style` does not have loading state for tracking insertions. I
                // guess because these aren't suspensey? Not sure whether this is a
                // factoring smell.
                // resource.state.loading |= Inserted;
                insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
                resource.instance = instance;
                return instance;
            }
            case 'stylesheet': {
                // This typing is enforce by `getResource`. If we change the logic
                // there for what qualifies as a stylesheet resource we need to ensure
                // this cast still makes sense;
                const qualifiedProps: StylesheetQualifyingProps = props;
                const key = getStyleKey(qualifiedProps.href);
                // Attempt to hydrate instance from DOM
                let instance: null | Element = hoistableRoot.querySelector(getStylesheetSelectorFromKey(key));
                if (instance) {
                    resource.state.loading |= Inserted;
                    resource.instance = instance;
                    markNodeAsHoistable(instance);
                    return instance;
                }
                const stylesheetProps = stylesheetPropsFromRawProps(props);
                const preloadProps = preloadPropsMap.get(key);
                if (preloadProps) {
                    adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
                }
                // Construct and insert a new instance
                const ownerDocument = getDocumentFromRoot(hoistableRoot);
                instance = ownerDocument.createElement('link');
                markNodeAsHoistable(instance);
                const linkInstance: HTMLLinkElement = (instance as HTMLLinkElement);
                getNodeInternals(linkInstance).loadingPromise = new Promise<Event>((resolve, reject) => {
                    linkInstance.onload = resolve;
                    linkInstance.onerror = reject;
                });
                setInitialPropertiesOnPage(instance, 'link', stylesheetProps);
                resource.state.loading |= Inserted;
                insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
                resource.instance = instance;
                return instance;
            }
            case 'script': {
                // This typing is enforce by `getResource`. If we change the logic
                // there for what qualifies as a stylesheet resource we need to ensure
                // this cast still makes sense;
                const borrowedScriptProps: ScriptProps = props;
                const key = getScriptKey(borrowedScriptProps.src as string); // a string: getResource qualified these props
                // Attempt to hydrate instance from DOM
                let instance: null | Element = hoistableRoot.querySelector(getScriptSelectorFromKey(key));
                if (instance) {
                    resource.instance = instance;
                    markNodeAsHoistable(instance);
                    return instance;
                }
                let scriptProps = borrowedScriptProps;
                const preloadProps = preloadPropsMap.get(key);
                if (preloadProps) {
                    scriptProps = {};
                    assign(scriptProps, borrowedScriptProps);
                    adoptPreloadPropsForScript(scriptProps, preloadProps);
                }
                // Construct and insert a new instance
                const ownerDocument = getDocumentFromRoot(hoistableRoot);
                instance = ownerDocument.createElement('script');
                markNodeAsHoistable(instance);
                setInitialPropertiesOnPage(instance, 'link', scriptProps);
                (ownerDocument.head).appendChild(instance);
                resource.instance = instance;
                return instance;
            }
            case 'void': {
                return null;
            }
            default: {
                throw new Error(`acquireResource encountered a resource type it did not expect: "${(resource as Resource).type}". this is a bug in React.`);
            }
        }
    }
    else {
        // In the case of stylesheets, they might have already been assigned an
        // instance during `suspendResource`. But that doesn't mean they were
        // inserted, because the commit might have been interrupted. So we need to
        // check now.
        //
        // The other resource types are unaffected because they are not
        // yet suspensey.
        //
        // TODO: This is a bit of a code smell. Consider refactoring how
        // `suspendResource` and `acquireResource` work together. The idea is that
        // `suspendResource` does all the same stuff as `acquireResource` except
        // for the insertion.
        if (resource.type === 'stylesheet' &&
            (resource.state.loading & Inserted) === NotLoaded) {
            const qualifiedProps: StylesheetQualifyingProps = props;
            const instance: Element = resource.instance;
            resource.state.loading |= Inserted;
            insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
        }
    }
    return resource.instance;
}
export function releaseResource(resource: Resource): void {
    resource.count--;
}
function insertStylesheet(instance: Element, precedence: string, root: HoistableRoot): void {
    const nodes = root.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]');
    const last = nodes.length ? nodes[nodes.length - 1] : null;
    let prior = last;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const nodePrecedence = node.dataset.precedence;
        if (nodePrecedence === precedence) {
            prior = node;
        }
        else if (prior !== last) {
            break;
        }
    }
    if (prior) {
        // We get the prior from the document so we know it is in the tree.
        // We also know that links can't be the topmost Node so the parentNode
        // must exist.
        (prior.parentNode as Node).insertBefore(instance, prior.nextSibling);
    }
    else {
        const parent = root.nodeType === DOCUMENT_NODE
            ? ((root as Document).head as Element)
            : (root as ShadowRoot);
        parent.insertBefore(instance, parent.firstChild);
    }
}
function adoptPreloadPropsForStylesheet(stylesheetProps: StylesheetProps, preloadProps: PreloadProps | PreloadModuleProps): void {
    if (stylesheetProps.crossOrigin == null)
        stylesheetProps.crossOrigin = preloadProps.crossOrigin;
    if (stylesheetProps.referrerPolicy == null)
        stylesheetProps.referrerPolicy = preloadProps.referrerPolicy;
    if (stylesheetProps.title == null)
        stylesheetProps.title = preloadProps.title;
}
function adoptPreloadPropsForScript(scriptProps: ScriptProps, preloadProps: PreloadProps | PreloadModuleProps): void {
    if (scriptProps.crossOrigin == null)
        scriptProps.crossOrigin = preloadProps.crossOrigin;
    if (scriptProps.referrerPolicy == null)
        scriptProps.referrerPolicy = preloadProps.referrerPolicy;
    if (scriptProps.integrity == null)
        scriptProps.integrity = preloadProps.integrity;
}
// The tag name itself maps to null once the cache is seeded for that tag.
type KeyedTagCache = Map<string, Array<Element> | null>;
type DocumentTagCaches = Map<Document, KeyedTagCache>;
let tagCaches: null | DocumentTagCaches = null;
export function hydrateHoistable(hoistableRoot: HoistableRoot, type: HoistableTagType, props: any, internalInstanceHandle: Fiber): Instance {
    // Hydration is not supported over the DOM bridge (PATCHES.md): no server-rendered node is ever hydrated.
    throw hydrationUnsupported();
}
function getHydratableHoistableCache(type: HoistableTagType, keyAttribute: string, ownerDocument: Document): KeyedTagCache {
    let cache: KeyedTagCache;
    let caches: DocumentTagCaches;
    if (tagCaches === null) {
        cache = new Map();
        caches = tagCaches = new Map();
        caches.set(ownerDocument, cache);
    }
    else {
        caches = tagCaches;
        const maybeCache = caches.get(ownerDocument);
        if (!maybeCache) {
            cache = new Map();
            caches.set(ownerDocument, cache);
        }
        else {
            cache = maybeCache;
        }
    }
    if (cache.has(type)) {
        // We use type as a special key that signals that this cache has been seeded for this type
        return cache;
    }
    // Mark this cache as seeded for this type
    cache.set(type, null);
    const nodes = ownerDocument.getElementsByTagName(type);
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!isOwnedInstance(node) &&
            (type !== 'link' || node.getAttribute('rel') !== 'stylesheet') &&
            node.namespaceURI !== SVG_NAMESPACE) {
            const nodeKey = node.getAttribute(keyAttribute) || '';
            const key = type + nodeKey;
            const existing = cache.get(key);
            if (existing) {
                existing.push(node);
            }
            else {
                cache.set(key, [node]);
            }
        }
    }
    return cache;
}
// The page inserts and removes a hoistable in its head (a sync point each).
export function mountHoistable(hoistableRoot: HoistableRoot, type: HoistableTagType, instance: Instance): void {
    const ownerDocument = getDocumentFromRoot(hoistableRoot);
    (ownerDocument.head).insertBefore(page(instance), type === 'title' ? ownerDocument.querySelector('head > title') : null);
}
export function unmountHoistable(instance: Instance): void {
    const element = page(instance);
    (element.parentNode!).removeChild(element);
}
export function isHostHoistableType(type: string, props: RawProps, hostContext: HostContext): boolean {
    let outsideHostContainerContext: boolean;
    let hostContextProd: HostContextProd;
    {
        hostContextProd = (hostContext as HostContextNamespace);
    }
    // Global opt out of hoisting for anything in SVG Namespace or anything with an itemProp inside an itemScope
    if (hostContextProd === HostContextNamespaceSvg || props.itemProp != null) {
        ;
        return false;
    }
    switch (type) {
        case 'meta':
        case 'title': {
            return true;
        }
        case 'style': {
            if (typeof props.precedence !== 'string' ||
                typeof props.href !== 'string' ||
                props.href === '') {
                ;
                return false;
            }
            return true;
        }
        case 'link': {
            if (typeof props.rel !== 'string' ||
                typeof props.href !== 'string' ||
                props.href === '' ||
                props.onLoad ||
                props.onError) {
                ;
                return false;
            }
            switch (props.rel) {
                case 'stylesheet': {
                    const { precedence, disabled } = props;
                    ;
                    return typeof precedence === 'string' && disabled == null;
                }
                default: {
                    return true;
                }
            }
        }
        case 'script': {
            const isAsync = props.async &&
                typeof props.async !== 'function' &&
                typeof props.async !== 'symbol';
            if (!isAsync ||
                props.onLoad ||
                props.onError ||
                !props.src ||
                typeof props.src !== 'string') {
                ;
                return false;
            }
            return true;
        }
        case 'noscript':
        case 'template': {
            ;
            return false;
        }
    }
    return false;
}
export function maySuspendCommit(type: Type, props: Props): boolean {
    {
        return false;
    }
}
export function maySuspendCommitOnUpdate(type: Type, oldProps: Props, newProps: Props): boolean {
    return (maySuspendCommit(type, newProps) &&
        (newProps.src !== oldProps.src || newProps.srcSet !== oldProps.srcSet));
}
export function maySuspendCommitInSyncRender(type: Type, props: Props): boolean {
    // TODO: Allow sync lanes to suspend too with an opt-in.
    return false;
}
export function mayResourceSuspendCommit(resource: Resource): boolean {
    return (resource.type === 'stylesheet' &&
        (resource.state.loading & Inserted) === NotLoaded);
}
export function preloadInstance(instance: Instance, type: Type, props: Props): boolean {
    // We don't need to preload Suspensey images because the browser will
    // load them early once we set the src.
    // If we return true here, we'll still get a suspendInstance call in the
    // pre-commit phase to determine if we still need to decode the image or
    // if was dropped from cache. This just avoids rendering Suspense fallback.
    return !!(page(instance) as HTMLImageElement).complete;
}
export function preloadResource(resource: Resource): boolean {
    if (resource.type === 'stylesheet' &&
        (resource.state.loading & Settled) === NotLoaded) {
        // Return false to indicate this resource should suspend
        return false;
    }
    // Return true to indicate this resource should not suspend
    return true;
}
export type SuspendedState = {
    stylesheets: null | Map<StylesheetResource, HoistableRoot>;
    count: number; // suspensey css and active view transitions;
    imgCount: number; // suspensey images pending to load;
    imgBytes: number; // number of bytes we estimate needing to download;
    suspenseyImages: Array<HTMLImageElement>; // instances of suspensey images (whether loaded or not);
    waitingForImages: boolean; // false when we're no longer blocking on images;
    waitingForViewTransition: boolean;
    unsuspend: null | (() => void);
};
export function startSuspendingCommit(): SuspendedState {
    return {
        stylesheets: null,
        count: 0,
        imgCount: 0,
        imgBytes: 0,
        suspenseyImages: [],
        waitingForImages: true,
        waitingForViewTransition: false,
        // We use a noop function when we begin suspending because if possible we want the
        // waitfor step to finish synchronously. If it doesn't we'll return a function to
        // provide the actual unsuspend function and that will get completed when the count
        // hits zero or it will get cancelled if the root starts new work.
        unsuspend: noop,
    };
}
export function suspendInstance(state: SuspendedState, instance: Instance, type: Type, props: Props): void {
    {
        return;
    }
}
export function suspendResource(state: SuspendedState, hoistableRoot: HoistableRoot, resource: Resource, props: any): void {
    if (resource.type === 'stylesheet') {
        if (typeof props.media === 'string') {
            // If we don't currently match media we avoid suspending on this resource
            // and let it insert on the mutation path
            if (matchMedia(props.media).matches === false) {
                return;
            }
        }
        if ((resource.state.loading & Inserted) === NotLoaded) {
            if (resource.instance === null) {
                const qualifiedProps: StylesheetQualifyingProps = props;
                const key = getStyleKey(qualifiedProps.href);
                // Attempt to hydrate instance from DOM
                let instance: null | Element = hoistableRoot.querySelector(getStylesheetSelectorFromKey(key));
                if (instance) {
                    // If this instance has a loading state it came from the Fizz runtime.
                    // If there is not loading state it is assumed to have been server rendered
                    // as part of the preamble and therefore synchronously loaded. It could have
                    // errored however which we still do not yet have a means to detect. For now
                    // we assume it is loaded.
                    const maybeLoadingState: Promise<Event> | null | undefined = peekNodeInternals(instance)?.loadingPromise;
                    if (maybeLoadingState !== null &&
                        typeof maybeLoadingState === 'object' &&
                        typeof maybeLoadingState.then === 'function') {
                        const loadingState = maybeLoadingState;
                        state.count++;
                        const ping = () => onUnsuspend(state);
                        loadingState.then(ping, ping);
                    }
                    resource.state.loading |= Inserted;
                    resource.instance = instance;
                    markNodeAsHoistable(instance);
                    return;
                }
                const ownerDocument = getDocumentFromRoot(hoistableRoot);
                const stylesheetProps = stylesheetPropsFromRawProps(props);
                const preloadProps = preloadPropsMap.get(key);
                if (preloadProps) {
                    adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
                }
                // Construct and insert a new instance
                instance = ownerDocument.createElement('link');
                markNodeAsHoistable(instance);
                const linkInstance: HTMLLinkElement = (instance as HTMLLinkElement);
                // This Promise is a loading state used by the Fizz runtime. We need this incase there is a race
                // between this resource being rendered on the client and being rendered with a late completed boundary.
                getNodeInternals(linkInstance).loadingPromise = new Promise<Event>((resolve, reject) => {
                    linkInstance.onload = resolve;
                    linkInstance.onerror = reject;
                });
                setInitialPropertiesOnPage(instance, 'link', stylesheetProps);
                resource.instance = instance;
            }
            if (state.stylesheets === null) {
                state.stylesheets = new Map();
            }
            state.stylesheets.set(resource, hoistableRoot);
            const preloadEl = resource.state.preload;
            if (preloadEl && (resource.state.loading & Settled) === NotLoaded) {
                state.count++;
                const ping = () => onUnsuspend(state);
                preloadEl.addEventListener('load', ping);
                preloadEl.addEventListener('error', ping);
            }
        }
    }
}
export function suspendOnActiveViewTransition(state: SuspendedState, rootContainer: Container): void {
    const ownerDocument = rootContainer.nodeType === DOCUMENT_NODE
        ? rootContainer
        : rootContainer.ownerDocument;
    const activeViewTransition = peekNodeInternals(ownerDocument!)?.viewTransition;
    if (activeViewTransition == null) {
        return;
    }
    state.count++;
    state.waitingForViewTransition = true;
    const ping = () => onUnsuspend(state);
    activeViewTransition.finished.then(ping, ping);
}
const SUSPENSEY_STYLESHEET_TIMEOUT = 60000;
const SUSPENSEY_IMAGE_TIMEOUT = 800;
const SUSPENSEY_IMAGE_TIME_ESTIMATE = 500;
let estimatedBytesWithinLimit: number = 0;
export function waitForCommitToBeReady(state: SuspendedState, timeoutOffset: number): null | ((arg1: () => void) => () => void) {
    if (state.stylesheets && state.count === 0) {
        // We are not currently blocked but we have not inserted all stylesheets.
        // If this insertion happens and loads or errors synchronously then we can
        // avoid suspending the commit. To do this we check the count again immediately after
        insertSuspendedStylesheets(state, state.stylesheets);
    }
    // We need to check the count again because the inserted stylesheets may have led to new
    // tasks to wait on.
    if (state.count > 0 || state.imgCount > 0) {
        return (commit: () => void) => {
            // We almost never want to show content before its styles have loaded. But
            // eventually we will give up and allow unstyled content. So this number is
            // somewhat arbitrary — big enough that you'd only reach it under
            // extreme circumstances.
            // TODO: Figure out what the browser engines do during initial page load and
            // consider aligning our behavior with that.
            const stylesheetTimer = setTimeout(() => {
                if (state.stylesheets) {
                    insertSuspendedStylesheets(state, state.stylesheets);
                }
                if (state.unsuspend) {
                    const unsuspend = state.unsuspend;
                    state.unsuspend = null;
                    unsuspend();
                }
            }, SUSPENSEY_STYLESHEET_TIMEOUT + timeoutOffset);
            if (state.imgBytes > 0 && estimatedBytesWithinLimit === 0) {
                // Estimate how many bytes we can download in 500ms.
                const mbps = estimateBandwidth();
                estimatedBytesWithinLimit = mbps * 125 * SUSPENSEY_IMAGE_TIME_ESTIMATE;
            }
            // If we have more images to download than we expect to fit in the timeout, then
            // don't wait for images longer than 50ms. The 50ms lets us still do decoding and
            // hitting caches if it turns out that they're already in the HTTP cache.
            const imgTimeout = state.imgBytes > estimatedBytesWithinLimit
                ? 50
                : SUSPENSEY_IMAGE_TIMEOUT;
            const imgTimer = setTimeout(() => {
                // We're no longer blocked on images. If CSS resolves after this we can commit.
                state.waitingForImages = false;
                if (state.count === 0) {
                    if (state.stylesheets) {
                        insertSuspendedStylesheets(state, state.stylesheets);
                    }
                    if (state.unsuspend) {
                        const unsuspend = state.unsuspend;
                        state.unsuspend = null;
                        unsuspend();
                    }
                }
            }, imgTimeout + timeoutOffset);
            state.unsuspend = commit;
            return () => {
                state.unsuspend = null;
                clearTimeout(stylesheetTimer);
                clearTimeout(imgTimer);
            };
        };
    }
    return null;
}
function checkIfFullyUnsuspended(state: SuspendedState) {
    if (state.count === 0 && (state.imgCount === 0 || !state.waitingForImages)) {
        if (state.stylesheets) {
            // If we haven't actually inserted the stylesheets yet we need to do so now before starting the commit.
            // The reason we do this after everything else has finished is because we want to have all the stylesheets
            // load synchronously right before mutating. Ideally the new styles will cause a single recalc only on the
            // new tree. When we filled up stylesheets we only inlcuded stylesheets with matching media attributes so we
            // wait for them to load before actually continuing. We expect this to increase the count above zero
            insertSuspendedStylesheets(state, state.stylesheets);
        }
        else if (state.unsuspend) {
            const unsuspend = state.unsuspend;
            state.unsuspend = null;
            unsuspend();
        }
    }
}
// React's `onUnsuspend.bind(state)` / `.call(state)` (a this-parameter function) takes the state as its parameter.
function onUnsuspend(state: SuspendedState) {
    state.count--;
    checkIfFullyUnsuspended(state);
}
// We use a value that is type distinct from precedence to track which one is last.
// This ensures there is no collision with user defined precedences. Normally we would
// just track this in module scope but since the precedences are tracked per HoistableRoot
// we need to associate it to something other than a global scope hence why we try to
// colocate it with the map of precedences in the first place
const LAST_PRECEDENCE = null;
// This is typecast to non-null because it will always be set before read.
// it is important that this not be used except when the stack guarantees it exists.
// Currentlyt his is only during insertSuspendedStylesheet.
let precedencesByRoot: Map<HoistableRoot, Map<string | typeof LAST_PRECEDENCE, Element>> | null = null;
function insertSuspendedStylesheets(state: SuspendedState, resources: Map<StylesheetResource, HoistableRoot>): void {
    // We need to clear this out so we don't try to reinsert after the stylesheets have loaded
    state.stylesheets = null;
    if (state.unsuspend === null) {
        // The suspended commit was cancelled. We don't need to insert any stylesheets.
        return;
    }
    // Temporarily increment count. we don't want any synchronously loaded stylesheets to try to unsuspend
    // before we finish inserting all stylesheets.
    state.count++;
    precedencesByRoot = new Map();
    resources.forEach((root, resource, map) => insertStylesheetIntoRoot(state, root, resource, map));
    precedencesByRoot = null;
    // We can remove our temporary count and if we're still at zero we can unsuspend.
    // If we are in the synchronous phase before deciding if the commit should suspend and this
    // ends up hitting the unsuspend path it will just invoke the noop unsuspend.
    onUnsuspend(state);
}
function insertStylesheetIntoRoot(state: SuspendedState, root: HoistableRoot, resource: StylesheetResource, map: Map<StylesheetResource, HoistableRoot>) {
    if (resource.state.loading & Inserted) {
        // This resource was inserted by another root committing. we don't need to insert it again
        return;
    }
    let last;
    let precedences = precedencesByRoot!.get(root);
    if (!precedences) {
        precedences = new Map();
        precedencesByRoot!.set(root, precedences);
        const nodes = root.querySelectorAll('link[data-precedence],style[data-precedence]');
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.nodeName === 'LINK' ||
                // We omit style tags with media="not all" because they are not in the right position
                // and will be hoisted by the Fizz runtime imminently.
                node.getAttribute('media') !== 'not all') {
                precedences.set((node as HTMLElement).dataset.precedence!, node);
                last = node;
            }
        }
        if (last) {
            precedences.set(LAST_PRECEDENCE, last);
        }
    }
    else {
        last = precedences.get(LAST_PRECEDENCE);
    }
    // We only call state after we have constructed an instance so we assume it here
    const instance: HTMLLinkElement = (resource.instance as HTMLLinkElement);
    // We will always have a precedence for stylesheet instances
    const precedence: string = (instance.getAttribute('data-precedence')!);
    const prior = precedences.get(precedence) || last;
    if (prior === last) {
        precedences.set(LAST_PRECEDENCE, instance);
    }
    precedences.set(precedence, instance);
    state.count++;
    const onComplete = () => onUnsuspend(state);
    instance.addEventListener('load', onComplete);
    instance.addEventListener('error', onComplete);
    if (prior) {
        (prior.parentNode!).insertBefore(instance, prior.nextSibling);
    }
    else {
        const parent = root.nodeType === DOCUMENT_NODE
            ? ((root as Document).head as Element)
            : (root as ShadowRoot);
        parent.insertBefore(instance, parent.firstChild);
    }
    resource.state.loading |= Inserted;
}
export const NotPendingTransition: TransitionStatus = NotPending;
export const HostTransitionContext: ReactContext<TransitionStatus> = {
    $$typeof: REACT_CONTEXT_TYPE,
    Provider: null,
    Consumer: null,
    _currentValue: NotPendingTransition,
    _currentValue2: NotPendingTransition,
    _threadCount: 0,
};
export type FormInstance = HTMLFormElement;
export function resetFormInstance(form: FormInstance): void {
    form.reset();
}
