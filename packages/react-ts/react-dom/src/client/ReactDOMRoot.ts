/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { adoptNode, DomDocument, DomElement, flushDom, release } from 'dom-stream/dom';
import type { Container, SuspenseInstance } from 'react-dom-bindings/src/client/ReactFiberConfigDOM';
import type { ReactNodeList, ReactFormState } from 'shared/ReactTypes';
import type { FiberRoot, TransitionTracingCallbacks, } from 'react-reconciler/src/ReactInternalTypes';
import { isValidContainer } from 'react-dom-bindings/src/client/ReactDOMContainer';
import { queueExplicitHydrationTarget } from 'react-dom-bindings/src/events/ReactDOMEventReplaying';
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { disableCommentsAsDOMContainers, enableDefaultTransitionIndicator, } from 'shared/ReactFeatureFlags';
export type RootType = {
    render(children: ReactNodeList): void;
    unmount(): void;
    _internalRoot: FiberRoot | null;
};
export type CreateRootOptions = {
    unstable_strictMode?: boolean;
    unstable_transitionCallbacks?: TransitionTracingCallbacks;
    identifierPrefix?: string;
    onUncaughtError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    onCaughtError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
        readonly errorBoundary?: object | null | undefined; // the boundary class instance
    }) => void;
    onRecoverableError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    onDefaultTransitionIndicator?: () => undefined | (() => void);
};
export type HydrateRootOptions = {
    // Hydration options
    // Over the DOM bridge a boundary is the bridge's comment node (hydration is not supported through it: PATCHES.md).
    onHydrated?: (hydrationBoundary: SuspenseInstance) => void;
    onDeleted?: (hydrationBoundary: SuspenseInstance) => void;
    // Options for all roots
    unstable_strictMode?: boolean;
    unstable_transitionCallbacks?: TransitionTracingCallbacks;
    identifierPrefix?: string;
    onUncaughtError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    onCaughtError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
        readonly errorBoundary?: object | null | undefined; // the boundary class instance
    }) => void;
    onRecoverableError?: (error: unknown, errorInfo: {
        readonly componentStack?: string | null | undefined;
    }) => void;
    onDefaultTransitionIndicator?: () => undefined | (() => void);
    formState?: ReactFormState<any, any> | null;
};
import { isContainerMarkedAsRoot, markContainerAsRoot, unmarkContainerAsRoot, } from 'react-dom-bindings/src/client/ReactDOMComponentTree';
import { listenToAllSupportedEvents } from 'react-dom-bindings/src/events/DOMPluginEventSystem';
import { COMMENT_NODE } from 'react-dom-bindings/src/client/HTMLNodeType';
import { createContainer, createHydrationContainer, updateContainer, updateContainerSync, flushSyncWork, isAlreadyRendering, defaultOnUncaughtError, defaultOnCaughtError, defaultOnRecoverableError, } from 'react-reconciler/src/ReactFiberReconciler';
import { defaultOnDefaultTransitionIndicator } from './ReactDOMDefaultTransitionIndicator';
import { ConcurrentRoot } from 'react-reconciler/src/ReactRootTags';
// React's function constructors with shared prototype methods, as classes (the methods become non-enumerable).
class ReactDOMRoot {
    _internalRoot: FiberRoot | null;
    constructor(internalRoot: FiberRoot) {
        this._internalRoot = internalRoot;
    }
    render(children: ReactNodeList): undefined {
        const root = this._internalRoot;
        if (root === null) {
            throw new Error('Cannot update an unmounted root.');
        }
        ;
        updateContainer(children, root, null, null);
    }
    unmount(): undefined {
        ;
        const root = this._internalRoot;
        if (root !== null) {
            this._internalRoot = null;
            const container = root.containerInfo;
            ;
            updateContainerSync(null, root, null, null);
            flushSyncWork();
            unmarkContainerAsRoot(container);
            // The adopted container leaves the bridge's node table (its root listeners with it); a later root adopts it afresh.
            release(container);
        }
    }
}
// A root container: the page's element (or document) adopted into the DOM bridge.
function adoptContainer(container: Element | Document | DocumentFragment): Container {
    const node = adoptNode(container);
    if (node instanceof DomDocument) {
        return node;
    }
    return node as DomElement;
}
export function createRoot(container: Element | Document | DocumentFragment, options?: CreateRootOptions): RootType {
    if (!isValidContainer(container)) {
        throw new Error('Target container is not a DOM element.');
    }
    warnIfReactDOMContainerInDEV(container);
    const concurrentUpdatesByDefaultOverride = false;
    let isStrictMode = false;
    let identifierPrefix = '';
    let onUncaughtError = defaultOnUncaughtError;
    let onCaughtError = defaultOnCaughtError;
    let onRecoverableError = defaultOnRecoverableError;
    let onDefaultTransitionIndicator = defaultOnDefaultTransitionIndicator;
    let transitionCallbacks = null;
    if (options !== null && options !== undefined) {
        ;
        if (options.unstable_strictMode === true) {
            isStrictMode = true;
        }
        if (options.identifierPrefix !== undefined) {
            identifierPrefix = options.identifierPrefix;
        }
        if (options.onUncaughtError !== undefined) {
            onUncaughtError = options.onUncaughtError;
        }
        if (options.onCaughtError !== undefined) {
            onCaughtError = options.onCaughtError;
        }
        if (options.onRecoverableError !== undefined) {
            onRecoverableError = options.onRecoverableError;
        }
        ;
        if (options.unstable_transitionCallbacks !== undefined) {
            transitionCallbacks = options.unstable_transitionCallbacks;
        }
    }
    // The container is the page's element: the DOM bridge adopts it (dom-stream), and React's host instances under it are the
    // bridge's nodes.
    const bridged = adoptContainer(container);
    const root = createContainer(bridged, ConcurrentRoot, null, isStrictMode, concurrentUpdatesByDefaultOverride, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, transitionCallbacks);
    markContainerAsRoot(root.current, bridged);
    // The root's listeners go through the stream; the page has them before createRoot returns.
    listenToAllSupportedEvents(bridged);
    flushDom();
    return new ReactDOMRoot(root);
}
class ReactDOMHydrationRoot extends ReactDOMRoot {
    unstable_scheduleHydration(target: Node): void {
        scheduleHydration(target);
    }
}
function scheduleHydration(target: Node) {
    if (target) {
        queueExplicitHydrationTarget(target);
    }
}
export function hydrateRoot(container: Document | Element, initialChildren: ReactNodeList, options?: HydrateRootOptions): RootType {
    // The DOM bridge creates every node React renders: hydrating server-rendered nodes is not supported over it (PATCHES.md).
    if (container !== null) {
        throw new Error('hydrateRoot is not supported over the DOM bridge.');
    }
    if (!isValidContainer(container)) {
        throw new Error('Target container is not a DOM element.');
    }
    warnIfReactDOMContainerInDEV(container);
    ;
    // For now we reuse the whole bag of options since they contain
    // the hydration callbacks.
    const hydrationCallbacks = options != null ? options : null;
    const concurrentUpdatesByDefaultOverride = false;
    let isStrictMode = false;
    let identifierPrefix = '';
    let onUncaughtError = defaultOnUncaughtError;
    let onCaughtError = defaultOnCaughtError;
    let onRecoverableError = defaultOnRecoverableError;
    let onDefaultTransitionIndicator = defaultOnDefaultTransitionIndicator;
    let transitionCallbacks = null;
    let formState = null;
    if (options !== null && options !== undefined) {
        if (options.unstable_strictMode === true) {
            isStrictMode = true;
        }
        if (options.identifierPrefix !== undefined) {
            identifierPrefix = options.identifierPrefix;
        }
        if (options.onUncaughtError !== undefined) {
            onUncaughtError = options.onUncaughtError;
        }
        if (options.onCaughtError !== undefined) {
            onCaughtError = options.onCaughtError;
        }
        if (options.onRecoverableError !== undefined) {
            onRecoverableError = options.onRecoverableError;
        }
        ;
        if (options.unstable_transitionCallbacks !== undefined) {
            transitionCallbacks = options.unstable_transitionCallbacks;
        }
        if (options.formState !== undefined) {
            formState = options.formState;
        }
    }
    const bridged = adoptContainer(container);
    const root = createHydrationContainer(initialChildren, null, bridged, ConcurrentRoot, hydrationCallbacks, isStrictMode, concurrentUpdatesByDefaultOverride, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, transitionCallbacks, formState);
    markContainerAsRoot(root.current, bridged);
    // This can't be a comment node since hydration doesn't work on comment nodes anyway.
    listenToAllSupportedEvents(bridged);
    return new ReactDOMHydrationRoot(root);
}
function warnIfReactDOMContainerInDEV(container: unknown) {
    ;
}
