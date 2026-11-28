/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
import type { LazyComponent } from './ReactLazy';
import isArray from 'shared/isArray';
import noop from 'shared/noop';
import { getIteratorFn,REACT_ELEMENT_TYPE,REACT_LAZY_TYPE,REACT_PORTAL_TYPE } from 'shared/ReactSymbols';
import type { FulfilledThenable,PendingThenable,ReactNodeList,RejectedThenable,Thenable } from 'shared/ReactTypes';
import { cloneAndReplaceKey,isValidElement } from './jsx/ReactJSXElement';
const SEPARATOR = '.';
const SUBSEPARATOR = ':';
/**
 * Escape and wrap key so it is safe to use as a reactid
 *
 * @param {string} key to be escaped.
 * @return {string} the escaped key.
 */
function escape(key: string): string {
    const escapeRegex = /[=:]/g;
    const escaperLookup = {
        '=': '=0',
        ':': '=2',
    } as const;
    const escapedString = key.replace(escapeRegex, function (match) {
        return escaperLookup[match as '=' | ':'];
    });
    return '$' + escapedString;
}
const userProvidedKeyEscapeRegex = /\/+/g;
function escapeUserProvidedKey(text: string): string {
    return text.replace(userProvidedKeyEscapeRegex, '$&/');
}
/**
 * Generate a key string that identifies a element within a set.
 *
 * @param {*} element A element that could contain a manual key.
 * @param {number} index Index that is used if a manual key is not provided.
 * @return {string}
 */
function getElementKey(element: unknown, index: number): string {
    // Do some typechecking here since we call this blindly. We want to ensure
    // that we don't block potential future ES APIs.
    if (typeof element === 'object' && element !== null && readProperty(element as object, 'key') != null) {
        ;
        return escape('' + readProperty(element as object, 'key'));
    }
    // Implicit key determined by the index in the set
    return index.toString(36);
}
function resolveThenable<T>(thenable: Thenable<T>): T {
    switch (thenable.status) {
        case 'fulfilled': {
            const fulfilledValue: T = thenable.value as T; // status is 'fulfilled': value holds the result
            return fulfilledValue;
        }
        case 'rejected': {
            const rejectedError = thenable.reason;
            throw rejectedError;
        }
        default: {
            if (typeof thenable.status === 'string') {
                // Only instrument the thenable if the status if not defined. If
                // it's defined, but an unknown value, assume it's been instrumented by
                // some custom userspace implementation. We treat it as "pending".
                // Attach a dummy listener, to ensure that any lazy initialization can
                // happen. Flight lazily parses JSON when the value is actually awaited.
                thenable.then(noop, noop);
            }
            else {
                // This is an uncached thenable that we haven't seen before.
                // TODO: Detect infinite ping loops caused by uncached promises.
                const pendingThenable: PendingThenable<T> = thenable;
                pendingThenable.status = 'pending';
                pendingThenable.then((fulfilledValue) => {
                    if (thenable.status === 'pending') {
                        const fulfilledThenable: FulfilledThenable<T> = (thenable);
                        fulfilledThenable.status = 'fulfilled';
                        fulfilledThenable.value = fulfilledValue;
                    }
                }, (error: unknown) => {
                    if (thenable.status === 'pending') {
                        const rejectedThenable: RejectedThenable<T> = (thenable);
                        rejectedThenable.status = 'rejected';
                        rejectedThenable.reason = error;
                    }
                });
            }
            // Check one more time in case the thenable resolved synchronously.
            switch ((thenable as Thenable<T>).status) {
                case 'fulfilled': {
                    const fulfilledThenable: FulfilledThenable<T> = thenable;
                    return fulfilledThenable.value as T; // status is 'fulfilled'
                }
                case 'rejected': {
                    const rejectedThenable: RejectedThenable<T> = thenable;
                    const rejectedError = rejectedThenable.reason;
                    throw rejectedError;
                }
            }
        }
    }
    throw thenable;
}
// Children utilities accept any value: React's Flow type is `?ReactNodeList` but every shape is checked at run time.
function mapIntoArray(children: unknown, array: Array<unknown>, escapedPrefix: string, nameSoFar: string, callback: (child: unknown) => unknown): number {
    const type = typeof children;
    if (type === 'undefined' || type === 'boolean') {
        // All of the above are perceived as null.
        children = null;
    }
    let invokeCallback = false;
    if (children === null) {
        invokeCallback = true;
    }
    else {
        switch (type) {
            case 'bigint':
            case 'string':
            case 'number':
                invokeCallback = true;
                break;
            case 'object':
                switch (readProperty(children as object, '$$typeof')) {
                    case REACT_ELEMENT_TYPE:
                    case REACT_PORTAL_TYPE:
                        invokeCallback = true;
                        break;
                    case REACT_LAZY_TYPE:
                        const payload = (children as LazyComponent<unknown, unknown>)._payload;
                        const init = (children as LazyComponent<unknown, unknown>)._init;
                        return mapIntoArray(init(payload), array, escapedPrefix, nameSoFar, callback);
                }
        }
    }
    if (invokeCallback) {
        const child = children;
        let mappedChild = callback(child);
        // If it's the only child, treat the name as if it was wrapped in an array
        // so that it's consistent if the number of children grows:
        const childKey = nameSoFar === '' ? SEPARATOR + getElementKey(child, 0) : nameSoFar;
        if (isArray(mappedChild)) {
            let escapedChildKey = '';
            if (childKey != null) {
                escapedChildKey = escapeUserProvidedKey(childKey) + '/';
            }
            mapIntoArray(mappedChild, array, escapedChildKey, '', (c) => c);
        }
        else if (mappedChild != null) {
            if (isValidElement(mappedChild)) {
                ;
                const newChild = cloneAndReplaceKey(mappedChild, 
                // Keep both the (mapped) and old keys if they differ, just as
                // traverseAllChildren used to do for objects as children
                escapedPrefix +
                    (mappedChild.key != null &&
                        (!child || readProperty(child as object, 'key') !== mappedChild.key)
                        ? escapeUserProvidedKey(
                        // eslint-disable-line react-internal/safe-string-coercion
                        '' + mappedChild.key) + '/'
                        : '') +
                    childKey);
                ;
                mappedChild = newChild;
            }
            array.push(mappedChild);
        }
        return 1;
    }
    let child;
    let nextName;
    let subtreeCount = 0; // Count of children found in the current subtree.
    const nextNamePrefix = nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;
    if (isArray(children)) {
        for (let i = 0; i < children!.length; i++) {
            child = children![i];
            nextName = nextNamePrefix + getElementKey(child, i);
            subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
        }
    }
    else {
        const iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === 'function') {
            const iterableChildren = (children as Iterable<unknown>);
            ;
            const iterator = iteratorFn.call(iterableChildren);
            let step;
            let ii = 0;
            while (!(step = iterator!.next()).done) {
                child = step.value;
                nextName = nextNamePrefix + getElementKey(child, ii++);
                subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
            }
        }
        else if (type === 'object') {
            if (typeof readProperty(children as object, 'then') === 'function') {
                return mapIntoArray(resolveThenable((children as Thenable<unknown>)), array, escapedPrefix, nameSoFar, callback);
            }
            // eslint-disable-next-line react-internal/safe-string-coercion
            const childrenString = String((children));
            throw new Error(`Objects are not valid as a React child (found: ${childrenString === '[object Object]'
                ? 'object with keys {' +
                    Object.keys((children!)).join(', ') +
                    '}'
                : childrenString}). ` +
                'If you meant to render a collection of children, use an array ' +
                'instead.');
        }
    }
    return subtreeCount;
}
type MapFunc = (child: unknown, index: number) => unknown;
/**
 * Maps children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * The provided mapFunction(child, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} func The map function.
 * @param {*} context Context for mapFunction.
 * @return {object} Object containing the ordered map of results.
 */
function mapChildren(children: unknown, func: MapFunc, context?: unknown): Array<unknown> | null | undefined {
    if (children == null) {
        return children;
    }
    const result: Array<unknown> = [];
    let count = 0;
    mapIntoArray(children, result, '', '', function (child) {
        return func.call(context, child, count++);
    });
    return result;
}
/**
 * Count the number of children that are typically specified as
 * `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param {?*} children Children tree container.
 * @return {number} The number of children.
 */
function countChildren(children?: unknown): number {
    let n = 0;
    mapChildren(children, () => {
        n++;
        // Don't return anything
    });
    return n;
}
type ForEachFunc = (child: unknown, index: number) => void;
/**
 * Iterates through children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * The provided forEachFunc(child, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} forEachFunc
 * @param {*} forEachContext Context for forEachContext.
 */
function forEachChildren(children: unknown, forEachFunc: ForEachFunc, forEachContext?: unknown): void {
    // mapChildren calls this with forEachContext as `this`; it is passed on explicitly.
    mapChildren(children, (child: unknown, index: number) => {
        forEachFunc.call(forEachContext, child, index);
        // Don't return anything.
    }, forEachContext);
}
/**
 * Flatten a children object (typically specified as `props.children`) and
 * return an array with appropriately re-keyed children.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
 */
function toArray(children?: unknown): Array<unknown> {
    return mapChildren(children, (child) => child) || [];
}
/**
 * Returns the first child in a collection of children and verifies that there
 * is only one child in the collection.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * The current implementation of this function assumes that a single child gets
 * passed without a wrapper, but the purpose of this helper function is to
 * abstract away the particular structure of children.
 *
 * @param {?object} children Child collection structure.
 * @return {ReactElement} The first and only `ReactElement` contained in the
 * structure.
 */
function onlyChild<T>(children: T): T {
    if (!isValidElement(children)) {
        throw new Error('React.Children.only expected to receive a single React element child.');
    }
    return children;
}
export { forEachChildren as forEach,mapChildren as map,countChildren as count,onlyChild as only,toArray,};
