/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// TODO: direct imports like some-package/src/* are bad. Fix me.
import { queueChangeEvent } from '../events/ReactDOMEventReplaying';
import { getToStringValue,toString } from './ToStringValue';
;
function updateOptions(node: HTMLSelectElement, multiple: boolean, propValue: unknown, setDefaultSelected: boolean) {
    const options: HTMLOptionsCollection = node.options;
    if (multiple) {
        const selectedValues = (propValue as Array<string>);
        const selectedValue: {
            [key: string]: boolean;
        } = {};
        for (let i = 0; i < selectedValues.length; i++) {
            // Prefix to avoid chaos with special keys.
            selectedValue['$' + selectedValues[i]] = true;
        }
        for (let i = 0; i < options.length; i++) {
            const selected = selectedValue.hasOwnProperty('$' + options[i].value);
            if (options[i].selected !== selected) {
                options[i].selected = selected;
            }
            if (selected && setDefaultSelected) {
                options[i].defaultSelected = true;
            }
        }
    }
    else {
        // Do not set `select.value` as exact behavior isn't consistent across all
        // browsers for all cases.
        const selectedValue = toString(getToStringValue(propValue));
        let defaultSelected = null;
        for (let i = 0; i < options.length; i++) {
            if (options[i].value === selectedValue) {
                options[i].selected = true;
                if (setDefaultSelected) {
                    options[i].defaultSelected = true;
                }
                return;
            }
            if (defaultSelected === null && !options[i].disabled) {
                defaultSelected = options[i];
            }
        }
        if (defaultSelected !== null) {
            defaultSelected.selected = true;
        }
    }
}
/**
 * Implements a <select> host component that allows optionally setting the
 * props `value` and `defaultValue`. If `multiple` is false, the prop must be a
 * stringable. If `multiple` is true, the prop must be an array of stringables.
 *
 * If `value` is not supplied (or null/undefined), user actions that change the
 * selected option will trigger updates to the rendered options.
 *
 * If it is supplied (and not null/undefined), the rendered options will not
 * update in response to user actions. Instead, the `value` prop must change in
 * order for the rendered options to update.
 *
 * If `defaultValue` is provided, any options with the supplied values will be
 * selected.
 */
export function validateSelectProps(element: Element, props: Record<any, any>) {
    ;
}
export function initSelect(element: Element, value?: string | null, defaultValue?: string | null, multiple?: boolean | null) {
    const node: HTMLSelectElement = (element as HTMLSelectElement);
    node.multiple = !!multiple;
    if (value != null) {
        updateOptions(node, !!multiple, value, false);
    }
    else if (defaultValue != null) {
        updateOptions(node, !!multiple, defaultValue, true);
    }
}
export function hydrateSelect(element: Element, value?: string | null, defaultValue?: string | null, multiple?: boolean | null): void {
    const node: HTMLSelectElement = (element as HTMLSelectElement);
    const options: HTMLOptionsCollection = node.options;
    const propValue = value != null ? value : defaultValue;
    let changed = false;
    if (multiple) {
        const selectedValues = (propValue as Array<string> | null | undefined);
        const selectedValue: {
            [key: string]: boolean;
        } = {};
        if (selectedValues != null) {
            for (let i = 0; i < selectedValues.length; i++) {
                // Prefix to avoid chaos with special keys.
                selectedValue['$' + selectedValues[i]] = true;
            }
        }
        for (let i = 0; i < options.length; i++) {
            const expectedSelected = selectedValue.hasOwnProperty('$' + options[i].value);
            if (options[i].selected !== expectedSelected) {
                changed = true;
                break;
            }
        }
    }
    else {
        let selectedValue = propValue == null ? null : toString(getToStringValue(propValue));
        for (let i = 0; i < options.length; i++) {
            if (selectedValue == null && !options[i].disabled) {
                // We expect the first non-disabled option to be selected if the selected is null.
                selectedValue = options[i].value;
            }
            const expectedSelected = options[i].value === selectedValue;
            if (options[i].selected !== expectedSelected) {
                changed = true;
                break;
            }
        }
    }
    if (changed) {
        // If the current selection is different than our initial that suggests that the user
        // changed it before hydration. Queue a replay of the change event.
        queueChangeEvent(node);
    }
}
export function updateSelect(element: Element, value?: string | null, defaultValue?: string | null, multiple?: boolean | null, wasMultiple?: boolean | null) {
    const node: HTMLSelectElement = (element as HTMLSelectElement);
    if (value != null) {
        updateOptions(node, !!multiple, value, false);
    }
    else if (!!wasMultiple !== !!multiple) {
        // For simplicity, reapply `defaultValue` if `multiple` is toggled.
        if (defaultValue != null) {
            updateOptions(node, !!multiple, defaultValue, true);
        }
        else {
            // Revert the select back to its default unselected state.
            updateOptions(node, !!multiple, multiple ? [] : '', false);
        }
    }
}
export function restoreControlledSelectState(element: Element, props: Record<any, any>) {
    const node: HTMLSelectElement = (element as HTMLSelectElement);
    const value = props.value;
    if (value != null) {
        updateOptions(node, !!props.multiple, value, false);
    }
}
