/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// TODO: direct imports like some-package/src/* are bad. Fix me.
import { queueChangeEvent } from '../events/ReactDOMEventReplaying';
import escapeSelectorAttributeValueInsideDoubleQuotes from './escapeSelectorAttributeValueInsideDoubleQuotes';
import getActiveElement from './getActiveElement';
import { track,trackHydrated,updateValueIfChanged } from './inputValueTracking';
import { getFiberCurrentPropsFromNode } from './ReactDOMComponentTree';
import type { ToStringValue } from './ToStringValue';
import { getToStringValue,toString } from './ToStringValue';
/**
 * Implements an <input> host component that allows setting these optional
 * props: `checked`, `value`, `defaultChecked`, and `defaultValue`.
 *
 * If `checked` or `value` are not supplied (or null/undefined), user actions
 * that affect the checked state or value will trigger updates to the element.
 *
 * If they are supplied (and not null/undefined), the rendered element will not
 * trigger updates to the element. Instead, the props must change in order for
 * the rendered element to be updated.
 *
 * The rendered element will be initialized as unchecked (or `defaultChecked`)
 * with an empty value (or `defaultValue`).
 *
 * See http://www.w3.org/TR/2012/WD-html5-20121025/the-input-element.html
 */
export function validateInputProps(element: Element, props: Record<any, any>) {
    ;
}
export function updateInput(element: Element, value?: string | null, defaultValue?: string | null, lastDefaultValue?: string | null, checked?: boolean | null, defaultChecked?: boolean | null, type?: string | null, name?: string | null) {
    const node: HTMLInputElement = (element as HTMLInputElement);
    // Temporarily disconnect the input from any radio buttons.
    // Changing the type or name as the same time as changing the checked value
    // needs to be atomically applied. We can only ensure that by disconnecting
    // the name while do the mutations and then reapply the name after that's done.
    node.name = '';
    if (type != null &&
        typeof type !== 'function' &&
        typeof type !== 'symbol' &&
        typeof type !== 'boolean') {
        ;
        node.type = type;
    }
    else {
        node.removeAttribute('type');
    }
    if (value != null) {
        if (type === 'number') {
            if (((value as unknown) === 0 && node.value === '') || // We explicitly want to coerce to number here if possible.
                // eslint-disable-next-line
                (node.value as unknown) != (value as unknown)) {
                node.value = toString(getToStringValue(value));
            }
        }
        else if (node.value !== toString(getToStringValue(value))) {
            node.value = toString(getToStringValue(value));
        }
    }
    else if (type === 'submit' || type === 'reset') {
        // Submit/reset inputs need the attribute removed completely to avoid
        // blank-text buttons.
        node.removeAttribute('value');
    }
    {
        // When syncing the value attribute, the value comes from a cascade of
        // properties:
        //  1. The value React property
        //  2. The defaultValue React property
        //  3. Otherwise there should be no change
        if (value != null) {
            setDefaultValue(node, type, getToStringValue(value));
        }
        else if (defaultValue != null) {
            setDefaultValue(node, type, getToStringValue(defaultValue));
        }
        else if (lastDefaultValue != null) {
            node.removeAttribute('value');
        }
    }
    {
        // When syncing the checked attribute, it only changes when it needs
        // to be removed, such as transitioning from a checkbox into a text input
        if (checked == null && defaultChecked != null) {
            node.defaultChecked = !!defaultChecked;
        }
    }
    if (checked != null) {
        // Important to set this even if it's not a change in order to update input
        // value tracking with radio buttons
        // TODO: Should really update input value tracking for the whole radio
        // button group in an effect or something (similar to #27024)
        node.checked =
            checked && typeof checked !== 'function' && typeof checked !== 'symbol';
    }
    if (name != null &&
        typeof name !== 'function' &&
        typeof name !== 'symbol' &&
        typeof name !== 'boolean') {
        ;
        node.name = toString(getToStringValue(name));
    }
    else {
        node.removeAttribute('name');
    }
}
export function initInput(element: Element, value: string | null | undefined, defaultValue: string | null | undefined, checked: boolean | null | undefined, defaultChecked: boolean | null | undefined, type: string | null | undefined, name: string | null | undefined, isHydrating: boolean) {
    const node: HTMLInputElement = (element as HTMLInputElement);
    if (type != null &&
        typeof type !== 'function' &&
        typeof type !== 'symbol' &&
        typeof type !== 'boolean') {
        ;
        node.type = type;
    }
    if (value != null || defaultValue != null) {
        const isButton = type === 'submit' || type === 'reset';
        // Avoid setting value attribute on submit/reset inputs as it overrides the
        // default value provided by the browser. See: #12872
        if (isButton && (value === undefined || value === null)) {
            // We track the value just in case it changes type later on.
            track(element as HTMLInputElement);
            return;
        }
        const defaultValueStr = defaultValue != null ? toString(getToStringValue(defaultValue)) : '';
        const initialValue = value != null ? toString(getToStringValue(value)) : defaultValueStr;
        // Do not assign value if it is already set. This prevents user text input
        // from being lost during SSR hydration.
        if (!isHydrating || false) {
            {
                // When syncing the value attribute, the value property should use
                // the wrapperState._initialValue property. This uses:
                //
                //   1. The value React property when present
                //   2. The defaultValue React property when present
                //   3. An empty string
                if (initialValue !== node.value) {
                    node.value = initialValue;
                }
            }
        }
        {
            // Otherwise, the value attribute is synchronized to the property,
            // so we assign defaultValue to the same thing as the value property
            // assignment step above.
            node.defaultValue = initialValue;
        }
    }
    // Normally, we'd just do `node.checked = node.checked` upon initial mount, less this bug
    // this is needed to work around a chrome bug where setting defaultChecked
    // will sometimes influence the value of checked (even after detachment).
    // Reference: https://bugs.chromium.org/p/chromium/issues/detail?id=608416
    // We need to temporarily unset name to avoid disrupting radio button groups.
    const checkedOrDefault = checked != null ? checked : defaultChecked;
    // TODO: This 'function' or 'symbol' check isn't replicated in other places
    // so this semantic is inconsistent.
    const initialChecked = typeof checkedOrDefault !== 'function' &&
        typeof checkedOrDefault !== 'symbol' &&
        !!checkedOrDefault;
    if (isHydrating && true) {
        // Detach .checked from .defaultChecked but leave user input alone
        node.checked = node.checked;
    }
    else {
        node.checked = !!initialChecked;
    }
    {
        // When syncing the checked attribute, both the checked property and
        // attribute are assigned at the same time using defaultChecked. This uses:
        //
        //   1. The checked React property when present
        //   2. The defaultChecked React property when present
        //   3. Otherwise, false
        node.defaultChecked = !node.defaultChecked;
        node.defaultChecked = !!initialChecked;
    }
    // Name needs to be set at the end so that it applies atomically to connected radio buttons.
    if (name != null &&
        typeof name !== 'function' &&
        typeof name !== 'symbol' &&
        typeof name !== 'boolean') {
        ;
        node.name = name;
    }
    track(element as HTMLInputElement);
}
export function hydrateInput(element: Element, value?: string | null, defaultValue?: string | null, checked?: boolean | null, defaultChecked?: boolean | null): void {
    const node: HTMLInputElement = (element as HTMLInputElement);
    const defaultValueStr = defaultValue != null ? toString(getToStringValue(defaultValue)) : '';
    const initialValue = value != null ? toString(getToStringValue(value)) : defaultValueStr;
    const checkedOrDefault = checked != null ? checked : defaultChecked;
    // TODO: This 'function' or 'symbol' check isn't replicated in other places
    // so this semantic is inconsistent.
    const initialChecked = typeof checkedOrDefault !== 'function' &&
        typeof checkedOrDefault !== 'symbol' &&
        !!checkedOrDefault;
    // Detach .checked from .defaultChecked but leave user input alone
    node.checked = node.checked;
    const changed = trackHydrated((node), initialValue, initialChecked);
    if (changed) {
        // If the current value is different, that suggests that the user
        // changed it before hydration. Queue a replay of the change event.
        // For radio buttons the change event only fires on the selected one.
        if (node.type !== 'radio' || node.checked) {
            queueChangeEvent(node);
        }
    }
}
export function restoreControlledInputState(element: Element, props: Record<any, any>) {
    const rootNode: HTMLInputElement = (element as HTMLInputElement);
    updateInput(rootNode, props.value, props.defaultValue, props.defaultValue, props.checked, props.defaultChecked, props.type, props.name);
    const name = props.name;
    if (props.type === 'radio' && name != null) {
        let queryRoot: Element = rootNode;
        while (queryRoot.parentNode) {
            queryRoot = (queryRoot.parentNode as Element);
        }
        ;
        const group = queryRoot.querySelectorAll('input[name="' +
            escapeSelectorAttributeValueInsideDoubleQuotes('' + name) +
            '"][type="radio"]');
        for (let i = 0; i < group.length; i++) {
            const otherNode = (group[i] as HTMLInputElement);
            if (otherNode === rootNode || otherNode.form !== rootNode.form) {
                continue;
            }
            // This will throw if radio buttons rendered by different copies of React
            // and the same name are rendered into the same form (same as #1939).
            // That's probably okay; we don't support it just as we don't support
            // mixing React radio buttons with non-React ones.
            // An input's props as React rendered them (value, checked and the rest are read as given).
            const otherProps = getFiberCurrentPropsFromNode(otherNode) as {
                value?: string | null;
                defaultValue?: string | null;
                checked?: boolean | null;
                defaultChecked?: boolean | null;
                type?: string | null;
                name?: string | null;
            } | null;
            if (!otherProps) {
                throw new Error('ReactDOMInput: Mixing React and non-React radio inputs with the ' +
                    'same `name` is not supported.');
            }
            // If this is a controlled radio button group, forcing the input that
            // was previously checked to update will cause it to be come re-checked
            // as appropriate.
            updateInput(otherNode, otherProps.value, otherProps.defaultValue, otherProps.defaultValue, otherProps.checked, otherProps.defaultChecked, otherProps.type, otherProps.name);
        }
        // If any updateInput() call set .checked to true, an input in this group
        // (often, `rootNode` itself) may have become unchecked
        for (let i = 0; i < group.length; i++) {
            const otherNode = (group[i] as HTMLInputElement);
            if (otherNode.form !== rootNode.form) {
                continue;
            }
            updateValueIfChanged(otherNode);
        }
    }
}
// In Chrome, assigning defaultValue to certain input types triggers input validation.
// For number inputs, the display value loses trailing decimal points. For email inputs,
// Chrome raises "The specified value <x> is not a valid email address".
// Here we check to see if the defaultValue has actually changed, avoiding these problems
// when the user is inputting text
// https://github.com/facebook/react/issues/7253
export function setDefaultValue(node: HTMLInputElement, type: string | null | undefined, value: ToStringValue) {
    if (
    // Focused number inputs synchronize on blur. See ChangeEventPlugin.js
    type !== 'number' ||
        getActiveElement(node.ownerDocument) !== node) {
        if (node.defaultValue !== toString(value)) {
            node.defaultValue = toString(value);
        }
    }
}
