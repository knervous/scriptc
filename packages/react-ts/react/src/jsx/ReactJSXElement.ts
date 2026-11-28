/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { readProperty } from 'shared/dynamicProperty';
import assign from 'shared/assign';
import hasOwnProperty from 'shared/hasOwnProperty';
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import type { ReactElement as ReactElementType } from 'shared/ReactElementType';
// An element's props: whatever keys the caller's config carries.
export type ElementProps = Record<string, unknown>;
type ElementConfig = Readonly<Record<string, unknown>>;
function getOwner() {
    ;
    return null;
}
;
function hasValidRef(config: ElementConfig) {
    ;
    return config.ref !== undefined;
}
function hasValidKey(config: ElementConfig) {
    ;
    return config.key !== undefined;
}
function ReactElement(type: unknown, key: string | null, props: ElementProps, owner: unknown, debugStack: unknown, debugTask: unknown): ReactElementType {
    // Ignore whatever was passed as the ref argument and treat `props.ref` as
    // the source of truth. The only thing we use this for is `element.ref`,
    // which will log a deprecation warning on access. In the next release, we
    // can remove `element.ref` as well as the `ref` argument.
    const refProp = props.ref;
    // An undefined `element.ref` is coerced to `null` for
    // backwards compatibility.
    const ref = refProp !== undefined ? refProp : null;
    let element: ReactElementType;
    {
        // In prod, `ref` is a regular property and _owner doesn't exist.
        // Its fields' types are exactly ReactElementType's ($$typeof as unknown), so the literal is that record type itself.
        element = {
            // This tag allows us to uniquely identify this as a React Element
            $$typeof: REACT_ELEMENT_TYPE as unknown,
            // Built-in properties that belong on the element
            type,
            key,
            ref,
            props,
        };
    }
    ;
    return element;
}
/**
 * https://github.com/reactjs/rfcs/pull/107
 * @param {*} type
 * @param {object} props
 * @param {string} key
 */
export function jsxProd(type: unknown, config: ElementProps, maybeKey?: unknown): ReactElementType {
    let key: string | null = null;
    if (maybeKey !== undefined) {
        ;
        key = '' + maybeKey;
    }
    if (hasValidKey(config)) {
        ;
        key = '' + config.key;
    }
    let props: ElementProps;
    if (!('key' in config)) {
        props = config;
    }
    else {
        props = {};
        for (const propName in config) {
            if (propName !== 'key') {
                props[propName] = config[propName];
            }
        }
    }
    return ReactElement(type, key, props, getOwner(), undefined, undefined);
}
/**
 * Create and return a new ReactElement of the given type.
 * See https://reactjs.org/docs/react-api.html#createelement
 */
// Children as a rest parameter: `children.length` is React's `arguments.length - 2`.
export function createElement(type: unknown, config?: ElementConfig | null, ...children: Array<unknown>): ReactElementType {
    ;
    let propName;
    const props: ElementProps = {};
    let key: string | null = null;
    if (config != null) {
        ;
        if (hasValidKey(config)) {
            ;
            key = '' + config.key;
        }
        for (propName in config) {
            if (hasOwnProperty.call(config, propName) &&
                propName !== 'key' &&
                propName !== '__self' &&
                propName !== '__source') {
                props[propName] = config[propName];
            }
        }
    }
    const childrenLength = children.length;
    if (childrenLength === 1) {
        props.children = children[0];
    }
    else if (childrenLength > 1) {
        const childArray = Array(childrenLength);
        for (let i = 0; i < childrenLength; i++) {
            childArray[i] = children[i];
        }
        ;
        props.children = childArray;
    }
    // A host type is a string, whose member read is the page's (String.prototype); only component types carry defaultProps.
    if (type && typeof type !== 'string' && readProperty(type as object, 'defaultProps')) {
        const defaultProps = readProperty(type as object, 'defaultProps') as object;
        for (propName in defaultProps) {
            if (props[propName] === undefined) {
                props[propName] = readProperty(defaultProps, propName);
            }
        }
    }
    ;
    return ReactElement(type, key, props, getOwner(), false, false);
}
export function cloneAndReplaceKey(oldElement: ReactElementType, newKey: string): ReactElementType {
    const clonedElement = ReactElement(oldElement.type, newKey, oldElement.props, undefined, false, false);
    ;
    return clonedElement;
}
/**
 * Clone and return a new ReactElement using element as the starting point.
 * See https://reactjs.org/docs/react-api.html#cloneelement
 */
export function cloneElement(element: ReactElementType | null | undefined, config?: ElementConfig | null, ...children: Array<unknown>): ReactElementType {
    if (element === null || element === undefined) {
        throw new Error(`The argument must be a React element, but you passed ${element}.`);
    }
    let propName;
    const props: ElementProps = assign({}, element.props);
    let key: string | null = element.key;
    let owner = undefined;
    if (config != null) {
        if (hasValidRef(config)) {
            owner = undefined;
        }
        if (hasValidKey(config)) {
            ;
            key = '' + config.key;
        }
        for (propName in config) {
            if (hasOwnProperty.call(config, propName) &&
                propName !== 'key' &&
                propName !== '__self' &&
                propName !== '__source' &&
                !(propName === 'ref' && config.ref === undefined)) {
                props[propName] = config[propName];
            }
        }
    }
    const childrenLength = children.length;
    if (childrenLength === 1) {
        props.children = children[0];
    }
    else if (childrenLength > 1) {
        const childArray = Array(childrenLength);
        for (let i = 0; i < childrenLength; i++) {
            childArray[i] = children[i];
        }
        props.children = childArray;
    }
    const clonedElement = ReactElement(element.type, key, props, owner, false, false);
    for (let i = 0; i < children.length; i++) {
        validateChildKeys(children[i]);
    }
    return clonedElement;
}
/**
 * Ensure that every element either is passed in a static location, in an
 * array with an explicit keys property defined, or in an object literal
 * with valid key property.
 *
 * @internal
 * @param {ReactNode} node Statically passed child of any type.
 * @param {*} parentType node's parent's type.
 */
function validateChildKeys(node: unknown) {
    ;
}
/**
 * Verifies the object is a ReactElement.
 * See https://reactjs.org/docs/react-api.html#isvalidelement
 * @param {?object} object
 * @return {boolean} True if `object` is a ReactElement.
 * @final
 */
export function isValidElement(object: unknown): object is ReactElementType {
    return (typeof object === 'object' &&
        object !== null &&
        readProperty(object as object, '$$typeof') === REACT_ELEMENT_TYPE);
}
