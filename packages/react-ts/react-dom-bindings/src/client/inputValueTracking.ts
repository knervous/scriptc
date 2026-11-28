import { readProperty } from 'shared/dynamicProperty';
import { getNodeInternals, peekNodeInternals } from './ReactDOMComponentTree';
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
type ValueTracker = {
    getValue(): string;
    setValue(value: string): void;
    stopTracking(): void;
};
export type { ValueTracker };
// The elements React tracks (inputs and textareas). Their `_valueTracker` expando is the node record's `valueTracker`.
type ElementWithValueTracker = HTMLInputElement | HTMLTextAreaElement;
function isCheckable(elem: ElementWithValueTracker) {
    const type = elem.type;
    const nodeName = elem.nodeName;
    return (nodeName &&
        nodeName.toLowerCase() === 'input' &&
        (type === 'checkbox' || type === 'radio'));
}
function getTracker(node: ElementWithValueTracker) {
    return peekNodeInternals(node)?.valueTracker;
}
function detachTracker(node: ElementWithValueTracker) {
    getNodeInternals(node).valueTracker = null;
}
function getValueFromNode(node: ElementWithValueTracker): string {
    let value = '';
    if (!node) {
        return value;
    }
    if (isCheckable(node)) {
        value = (node as HTMLInputElement).checked ? 'true' : 'false';
    }
    else {
        value = node.value;
    }
    return value;
}
function trackValueOnNode(node: ElementWithValueTracker, valueField: 'checked' | 'value', currentValue: string): ValueTracker | null | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(readProperty(node.constructor as object, 'prototype'), valueField);
    // if someone has already defined a value or Safari, then bail
    // and don't track value will cause over reporting of changes,
    // but it's better then a hard failure
    // (needed for certain tests that spyOn input values and Safari)
    if (node.hasOwnProperty(valueField) ||
        typeof descriptor === 'undefined' ||
        typeof descriptor.get !== 'function' ||
        typeof descriptor.set !== 'function') {
        return;
    }
    const { get, set } = descriptor;
    // The accessors close over `node` instead of reading `this`: they are installed on `node` itself.
    Object.defineProperty(node, valueField, {
        configurable: true,
        get: () => get.call(node),
        set: (value: unknown) => {
            currentValue = '' + value;
            set.call(node, value);
        },
    });
    // We could've passed this the first time
    // but it triggers a bug in IE11 and Edge 14/15.
    // Calling defineProperty() again should be equivalent.
    // https://github.com/facebook/react/issues/11768
    Object.defineProperty(node, valueField, {
        enumerable: descriptor.enumerable,
    });
    const tracker = {
        getValue() {
            return currentValue;
        },
        setValue(value: string) {
            ;
            currentValue = '' + value;
        },
        stopTracking() {
            detachTracker(node);
            Reflect.deleteProperty(node, valueField);
        },
    } as const;
    return tracker;
}
export function track(node: ElementWithValueTracker) {
    if (getTracker(node)) {
        return;
    }
    const valueField = isCheckable(node) ? 'checked' : 'value';
    // This is read from the DOM so always safe to coerce. We really shouldn't
    // be coercing to a string at all. It's just historical.
    // eslint-disable-next-line react-internal/safe-string-coercion
    const initialValue = '' + ((node as HTMLInputElement)[valueField]);
    getNodeInternals(node).valueTracker = trackValueOnNode(node, valueField, initialValue);
}
export function trackHydrated(node: ElementWithValueTracker, initialValue: string, initialChecked: boolean): boolean {
    // For hydration, the initial value is not the current value but the value
    // that we last observed which is what the initial server render was.
    if (getTracker(node)) {
        return false;
    }
    let valueField: 'checked' | 'value';
    let expectedValue;
    if (isCheckable(node)) {
        valueField = 'checked';
        // eslint-disable-next-line react-internal/safe-string-coercion
        expectedValue = '' + (initialChecked);
    }
    else {
        valueField = 'value';
        expectedValue = initialValue;
    }
    const currentValue = 
    // eslint-disable-next-line react-internal/safe-string-coercion
    '' +
        ((node as HTMLInputElement)[valueField]);
    getNodeInternals(node).valueTracker = trackValueOnNode(node, valueField, expectedValue);
    return currentValue !== expectedValue;
}
export function updateValueIfChanged(node: ElementWithValueTracker): boolean {
    if (!node) {
        return false;
    }
    const tracker = getTracker(node);
    // if there is no tracker at this point it's unlikely
    // that trying again will succeed
    if (!tracker) {
        return true;
    }
    const lastValue = tracker.getValue();
    const nextValue = getValueFromNode(node);
    if (nextValue !== lastValue) {
        tracker.setValue(nextValue);
        return true;
    }
    return false;
}
