/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { readProperty } from 'shared/dynamicProperty';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
import type { Props } from '../client/ReactFiberConfigDOM';
import { getFiberCurrentPropsFromNode } from '../client/ReactDOMComponentTree';
function isInteractive(tag: string): boolean {
    return (tag === 'button' ||
        tag === 'input' ||
        tag === 'select' ||
        tag === 'textarea');
}
function shouldPreventMouseEvent(name: string | null, type: string, props: Props): boolean {
    switch (name) {
        case 'onClick':
        case 'onClickCapture':
        case 'onDoubleClick':
        case 'onDoubleClickCapture':
        case 'onMouseDown':
        case 'onMouseDownCapture':
        case 'onMouseMove':
        case 'onMouseMoveCapture':
        case 'onMouseUp':
        case 'onMouseUpCapture':
        case 'onMouseEnter':
            return !!(props.disabled && isInteractive(type));
        default:
            return false;
    }
}
/**
 * @param {object} inst The instance, which is the source of events.
 * @param {string} registrationName Name of listener (e.g. `onClick`).
 * @return {?function} The stored callback.
 */
// `registrationName` is the event's `_reactName`: null for events React does not know, read as the key "null".
// An event handler from props (onClick and the like): React calls it with the synthetic event.
export type EventHandler = (event: unknown) => unknown;
export default function getListener(inst: Fiber, registrationName: string | null): EventHandler | null {
    const stateNode = inst.stateNode;
    if (stateNode === null) {
        // Work in progress (ex: onload events in incremental mode).
        return null;
    }
    const props = getFiberCurrentPropsFromNode(stateNode);
    if (props === null) {
        // Work in progress.
        return null;
    }
    const listener: unknown = readProperty(props, String(registrationName));
    if (shouldPreventMouseEvent(registrationName, inst.type, props)) {
        return null;
    }
    if (listener && typeof listener !== 'function') {
        throw new Error(`Expected \`${registrationName}\` listener to be a function, instead got a value of \`${typeof listener}\` type.`);
    }
    // An absent prop reads as undefined; every caller tests `!= null`, so it is the same as null.
    return listener === undefined ? null : listener as EventHandler | null;
}
