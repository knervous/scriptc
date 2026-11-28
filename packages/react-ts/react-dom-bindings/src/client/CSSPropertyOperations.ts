/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { toDOMString } from 'shared/dynamicProperty';
import type { DomElement, DomStyle } from 'dom-stream/dom';
import { trackHostMutation } from 'react-reconciler/src/ReactFiberMutationTracking';
import isUnitlessNumber from '../shared/isUnitlessNumber';
// The bridge's style writes (dom-stream's DomStyle.set): the page applies each as React DOM does here in the JavaScript build, a custom
// property (`--name`) through setProperty, `float` as cssFloat, any other name as the style's own property.
function setValueForStyle(style: DomStyle, styleName: string, value: unknown) {
    const isCustomProperty = styleName.indexOf('--') === 0;
    ;
    if (value == null || typeof value === 'boolean' || value === '') {
        style.set(styleName, '');
    }
    else if (isCustomProperty) {
        style.set(styleName, toDOMString(value));
    }
    else if (typeof value === 'number' &&
        value !== 0 &&
        !isUnitlessNumber(styleName)) {
        style.set(styleName, value + 'px'); // Presumes implicit 'px' suffix for unitless numbers
    }
    else {
        if (styleName === 'float') {
            style.set(styleName, toDOMString(value));
        }
        else {
            ;
            style.set(styleName, ('' + value).trim());
        }
    }
}
/**
 * Sets the value for multiple styles on a node.  If a value is specified as
 * '' (empty string), the corresponding style property will be unset.
 *
 * @param {DOMElement} node
 * @param {object} styles
 */
// Style objects: arbitrary style names to values.
type StyleObject = Readonly<Record<string, unknown>>;
// `styles` is the style prop as given (checked below); `prevStyles` is the previously committed one.
export function setValueForStyles(node: DomElement, stylesProp: unknown, prevStylesProp: unknown) {
    if (stylesProp != null && typeof stylesProp !== 'object') {
        throw new Error('The `style` prop expects a mapping from style properties to values, ' +
            "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
            'using JSX.');
    }
    ;
    const styles = stylesProp as StyleObject | null | undefined;
    const prevStyles = prevStylesProp as StyleObject | null | undefined;
    const style = node.style;
    if (prevStyles != null) {
        ;
        for (const styleName in prevStyles) {
            if (prevStyles.hasOwnProperty(styleName) &&
                (styles == null || !styles.hasOwnProperty(styleName))) {
                // Clear style
                style.set(styleName, '');
                trackHostMutation();
            }
        }
        for (const styleName in styles) {
            const value = styles[styleName];
            if (styles.hasOwnProperty(styleName) && prevStyles[styleName] !== value) {
                setValueForStyle(style, styleName, value);
                trackHostMutation();
            }
        }
    }
    else {
        for (const styleName in styles) {
            if (styles.hasOwnProperty(styleName)) {
                const value = styles[styleName];
                setValueForStyle(style, styleName, value);
            }
        }
    }
}
