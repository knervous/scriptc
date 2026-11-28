/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { writeProperty } from 'shared/dynamicProperty';
import { page, type DomElement } from 'dom-stream/dom';
import { trackHostMutation } from 'react-reconciler/src/ReactFiberMutationTracking';
import isAttributeNameSafe from '../shared/isAttributeNameSafe';
import { getFiberCurrentPropsFromNode } from './ReactDOMComponentTree';
export function setValueForAttribute(node: DomElement, name: string, value: unknown) {
    if (isAttributeNameSafe(name)) {
        // If the prop isn't in the special list, treat it as a simple attribute.
        // shouldRemoveAttribute
        if (value === null) {
            node.removeAttribute(name);
            return;
        }
        switch (typeof value) {
            case 'undefined':
            case 'function':
            case 'symbol':
                node.removeAttribute(name);
                return;
            case 'boolean': {
                const prefix = name.toLowerCase().slice(0, 5);
                if (prefix !== 'data-' && prefix !== 'aria-') {
                    node.removeAttribute(name);
                    return;
                }
            }
        }
        ;
        node.setAttribute(name, '' + (value));
    }
}
export function setValueForKnownAttribute(node: DomElement, name: string, value: unknown) {
    if (value === null) {
        node.removeAttribute(name);
        return;
    }
    switch (typeof value) {
        case 'undefined':
        case 'function':
        case 'symbol':
        case 'boolean': {
            node.removeAttribute(name);
            return;
        }
    }
    ;
    node.setAttribute(name, '' + (value));
}
export function setValueForNamespacedAttribute(node: DomElement, namespace: string, name: string, value: unknown) {
    if (value === null) {
        node.removeAttribute(name);
        return;
    }
    switch (typeof value) {
        case 'undefined':
        case 'function':
        case 'symbol':
        case 'boolean': {
            node.removeAttribute(name);
            return;
        }
    }
    ;
    node.setAttributeNS(namespace, name, '' + (value));
}
// A custom element's properties and listeners are the page's (a sync point: the stream is flushed first); its attributes go through
// the stream as any element's do.
export function setValueForPropertyOnCustomComponent(bridged: DomElement, name: string, value: unknown) {
    const node = page(bridged) as Element;
    if (name[0] === 'o' && name[1] === 'n') {
        const useCapture = name.endsWith('Capture');
        const eventName = name.slice(2, useCapture ? name.length - 7 : undefined);
        const prevProps = getFiberCurrentPropsFromNode(bridged);
        const prevValue = prevProps != null ? (prevProps as Readonly<Record<string, unknown>>)[name] : null;
        if (typeof prevValue === 'function') {
            node.removeEventListener(eventName, prevValue as EventListener, useCapture);
        }
        if (typeof value === 'function') {
            if (typeof prevValue !== 'function' && prevValue !== null) {
                // If we previously assigned a non-function type into this node, then
                // remove it when switching to event listener mode.
                if (name in (node)) {
                    writeProperty(node, name, null);
                }
                else if (node.hasAttribute(name)) {
                    bridged.removeAttribute(name);
                }
            }
            node.addEventListener(eventName, (value as EventListener), useCapture);
            return;
        }
    }
    trackHostMutation();
    if (name in (node)) {
        writeProperty(node, name, value);
        return;
    }
    if (value === true) {
        node.setAttribute(name, '');
        return;
    }
    // From here, it's the same as any attribute
    setValueForAttribute(bridged, name, value);
}
