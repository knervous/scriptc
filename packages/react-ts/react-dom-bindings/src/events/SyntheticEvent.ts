/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
/* eslint valid-typeof: 0 */
import { readProperty, writeProperty } from 'shared/dynamicProperty';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
import assign from 'shared/assign';
import getEventCharCode from './getEventCharCode';
/**
 * What a native event may carry across browsers: the modern fields, and the legacy ones older
 * engines expose instead (all optional, since which of them exist depends on the event).
 */
export interface NativeEventFields extends Event {
    readonly screenX?: number;
    readonly screenY?: number;
    readonly movementX?: number;
    readonly movementY?: number;
    readonly relatedTarget?: EventTarget | null;
    readonly fromElement?: EventTarget | null;
    readonly toElement?: EventTarget | null;
    readonly clipboardData?: DataTransfer | null;
    readonly key?: string;
    readonly keyCode?: number;
    readonly charCode?: number;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly altKey?: boolean;
    readonly metaKey?: boolean;
    readonly which?: number;
    readonly char?: string;
    readonly data?: string | null;
    readonly locale?: string;
    // UIEvent's detail, or a CustomEvent's (Google Input Tools passes composition data in it).
    readonly detail?: number | {
        data?: string | null;
    };
    readonly deltaX?: number;
    readonly deltaY?: number;
    readonly wheelDeltaX?: number;
    readonly wheelDeltaY?: number;
    readonly wheelDelta?: number;
    getModifierState?(keyArg: string): boolean;
}
declare global {
    interface Window {
        // Legacy (IE) clipboard access, read when the event has no `clipboardData`.
        clipboardData?: DataTransfer;
    }
}
type EventInterfaceType = {
    [propName: string]: 0 | ((event: NativeEventFields) => unknown);
};
// The spread `{...base, ...own}`: base's keys first, then own's (a repeated key keeps base's position).
function extendInterface(base: EventInterfaceType, own: EventInterfaceType): EventInterfaceType {
    const Interface: EventInterfaceType = {};
    return assign(assign(Interface, base), own);
}
function functionThatReturnsTrue() {
    return true;
}
function functionThatReturnsFalse() {
    return false;
}
/**
 * Synthetic events are dispatched by event plugins, typically in response to a
 * top-level event delegation handler.
 *
 * These systems should generally use pooling to reduce the frequency of garbage
 * collection. The system should check `isPersistent` to determine whether the
 * event should be released into the pool after being dispatched. Users that
 * need a persisted event should invoke `persist`.
 *
 * Synthetic events (and subclasses) implement the DOM Level 3 Events API by
 * normalizing browser quirks. Subclasses do not necessarily have to implement a
 * DOM interface; custom application-specific events can also subclass this.
 *
 * Upstream builds one such class per Interface and assigns the methods onto its prototype; here the methods are
 * the base class's own, and each Interface gets a declared subclass naming it (eventInterface), so every event
 * class is a SyntheticBaseEvent and the plugins can pick one by event type.
 */
export class SyntheticBaseEvent {
    // Declared only: the constructor assigns them, in this order.
    declare _reactName: string | null;
    declare _targetInst: Fiber | null;
    declare type: string;
    declare nativeEvent: NativeEventFields;
    declare target: null | undefined | EventTarget;
    declare currentTarget: null | EventTarget;
    declare defaultPrevented?: boolean;
    declare isDefaultPrevented: () => boolean;
    declare isPropagationStopped: () => boolean;
    // The Interface's properties, and what plugins attach (`data`, `relatedTarget`), are own expando properties:
    // read and write them with shared/dynamicProperty.
    constructor(reactName: string | null, reactEventType: string, targetInst: Fiber | null, nativeEvent: NativeEventFields, nativeEventTarget: null | EventTarget) {
        const Interface = this.eventInterface();
        this._reactName = reactName;
        this._targetInst = targetInst;
        this.type = reactEventType;
        this.nativeEvent = nativeEvent;
        this.target = nativeEventTarget;
        this.currentTarget = null;
        for (const propName in Interface) {
            if (!Interface.hasOwnProperty(propName)) {
                continue;
            }
            const normalize = Interface[propName];
            if (normalize) {
                writeProperty(this, propName, normalize(nativeEvent));
            }
            else {
                writeProperty(this, propName, readProperty(nativeEvent, propName));
            }
        }
        const defaultPrevented = nativeEvent.defaultPrevented != null
            ? nativeEvent.defaultPrevented
            : nativeEvent.returnValue === false;
        if (defaultPrevented) {
            this.isDefaultPrevented = functionThatReturnsTrue;
        }
        else {
            this.isDefaultPrevented = functionThatReturnsFalse;
        }
        this.isPropagationStopped = functionThatReturnsFalse;
    }
    preventDefault(): void {
        this.defaultPrevented = true;
        const event = this.nativeEvent;
        if (!event) {
            return;
        }
        const returnValueKind: string = typeof event.returnValue;
        if (event.preventDefault) {
            event.preventDefault();
        }
        else if (returnValueKind !== 'unknown') {
            event.returnValue = false;
        }
        this.isDefaultPrevented = functionThatReturnsTrue;
    }
    stopPropagation(): void {
        const event = this.nativeEvent;
        if (!event) {
            return;
        }
        const cancelBubbleKind: string = typeof event.cancelBubble;
        if (event.stopPropagation) {
            event.stopPropagation();
        }
        else if (cancelBubbleKind !== 'unknown') {
            // The ChangeEventPlugin registers a "propertychange" event for
            // IE. This event does not support bubbling or cancelling, and
            // any references to cancelBubble throw "Member not found".  A
            // typeof check of "unknown" circumvents this issue (and is also
            // IE specific).
            event.cancelBubble = true;
        }
        this.isPropagationStopped = functionThatReturnsTrue;
    }
    /**
     * We release all dispatched `SyntheticEvent`s after each event loop, adding
     * them back into the pool. This allows a way to hold onto a reference that
     * won't be added back into the pool.
     */
    persist(): void {
        // Modern event system doesn't use pooling.
    }
    /**
     * Checks if this event should be released back into the pool.
     *
     * @return {boolean} True if this should not be released, false otherwise.
     */
    isPersistent(): boolean {
        return true;
    }
    /** The Interface whose properties the constructor copies from the native event. */
    eventInterface(): EventInterfaceType {
        return EventInterface;
    }
}
// Upstream builds each Interface's class with a factory, so that each has its own constructor (one shared
// constructor would be megamorphic and engines would deopt). Here each is a declared subclass naming its Interface.
/**
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const EventInterface: EventInterfaceType = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function (event: NativeEventFields) {
        return event.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0,
};
export class SyntheticEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return EventInterface;
    }
}
const UIEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    view: 0,
    detail: 0,
});
export class SyntheticUIEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return UIEventInterface;
    }
}
let lastMovementX: number | undefined;
let lastMovementY: number | undefined;
let lastMouseEvent: NativeEventFields | null | undefined;
function updateMouseMovementPolyfillState(event: NativeEventFields) {
    if (event !== lastMouseEvent) {
        if (lastMouseEvent && event.type === 'mousemove') {
            lastMovementX = event.screenX! - lastMouseEvent.screenX!;
            lastMovementY = event.screenY! - lastMouseEvent.screenY!;
        }
        else {
            lastMovementX = 0;
            lastMovementY = 0;
        }
        lastMouseEvent = event;
    }
}
/**
 * @interface MouseEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const MouseEventInterface: EventInterfaceType = extendInterface(UIEventInterface, {
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    getModifierState: getEventModifierState,
    button: 0,
    buttons: 0,
    relatedTarget: function (event: NativeEventFields) {
        if (event.relatedTarget === undefined)
            return event.fromElement === event.srcElement
                ? event.toElement
                : event.fromElement;
        return event.relatedTarget;
    },
    movementX: function (event: NativeEventFields) {
        if ('movementX' in event) {
            return event.movementX;
        }
        updateMouseMovementPolyfillState(event);
        return lastMovementX;
    },
    movementY: function (event: NativeEventFields) {
        if ('movementY' in event) {
            return event.movementY;
        }
        // Don't need to call updateMouseMovementPolyfillState() here
        // because it's guaranteed to have already run when movementX
        // was copied.
        return lastMovementY;
    },
});
export class SyntheticMouseEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return MouseEventInterface;
    }
}
/**
 * @interface DragEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const DragEventInterface: EventInterfaceType = extendInterface(MouseEventInterface, {
    dataTransfer: 0,
});
export class SyntheticDragEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return DragEventInterface;
    }
}
/**
 * @interface FocusEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const FocusEventInterface: EventInterfaceType = extendInterface(UIEventInterface, {
    relatedTarget: 0,
});
export class SyntheticFocusEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return FocusEventInterface;
    }
}
/**
 * @interface Event
 * @see http://www.w3.org/TR/css3-animations/#AnimationEvent-interface
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AnimationEvent
 */
const AnimationEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    animationName: 0,
    elapsedTime: 0,
    pseudoElement: 0,
});
export class SyntheticAnimationEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return AnimationEventInterface;
    }
}
/**
 * @interface Event
 * @see http://www.w3.org/TR/clipboard-apis/
 */
const ClipboardEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    clipboardData: function (event: NativeEventFields) {
        return 'clipboardData' in event
            ? event.clipboardData
            : window.clipboardData;
    },
});
export class SyntheticClipboardEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return ClipboardEventInterface;
    }
}
/**
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#events-compositionevents
 */
const CompositionEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    data: 0,
});
export class SyntheticCompositionEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return CompositionEventInterface;
    }
}
/**
 * @interface Event
 * @see http://www.w3.org/TR/2013/WD-DOM-Level-3-Events-20131105
 *      /#events-inputevents
 */
// Happens to share the same list for now.
export const SyntheticInputEvent = SyntheticCompositionEvent;
/**
 * Normalization of deprecated HTML5 `key` values
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Key_names
 */
const normalizeKey: Readonly<Record<string, string>> = {
    Esc: 'Escape',
    Spacebar: ' ',
    Left: 'ArrowLeft',
    Up: 'ArrowUp',
    Right: 'ArrowRight',
    Down: 'ArrowDown',
    Del: 'Delete',
    Win: 'OS',
    Menu: 'ContextMenu',
    Apps: 'ContextMenu',
    Scroll: 'ScrollLock',
    MozPrintableKey: 'Unidentified',
};
/**
 * Translation from legacy `keyCode` to HTML5 `key`
 * Only special keys supported, all others depend on keyboard layout or browser
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Key_names
 */
const translateToKey: Readonly<Record<string, string>> = {
    '8': 'Backspace',
    '9': 'Tab',
    '12': 'Clear',
    '13': 'Enter',
    '16': 'Shift',
    '17': 'Control',
    '18': 'Alt',
    '19': 'Pause',
    '20': 'CapsLock',
    '27': 'Escape',
    '32': ' ',
    '33': 'PageUp',
    '34': 'PageDown',
    '35': 'End',
    '36': 'Home',
    '37': 'ArrowLeft',
    '38': 'ArrowUp',
    '39': 'ArrowRight',
    '40': 'ArrowDown',
    '45': 'Insert',
    '46': 'Delete',
    '112': 'F1',
    '113': 'F2',
    '114': 'F3',
    '115': 'F4',
    '116': 'F5',
    '117': 'F6',
    '118': 'F7',
    '119': 'F8',
    '120': 'F9',
    '121': 'F10',
    '122': 'F11',
    '123': 'F12',
    '144': 'NumLock',
    '145': 'ScrollLock',
    '224': 'Meta',
};
/**
 * @param {object} nativeEvent Native browser event.
 * @return {string} Normalized `key` property.
 */
function getEventKey(nativeEvent: NativeEventFields) {
    if (nativeEvent.key) {
        // Normalize inconsistent values reported by browsers due to
        // implementations of a working draft specification.
        // FireFox implements `key` but returns `MozPrintableKey` for all
        // printable characters (normalized to `Unidentified`), ignore it.
        const key = normalizeKey[nativeEvent.key] || nativeEvent.key;
        if (key !== 'Unidentified') {
            return key;
        }
    }
    // Browser does not implement `key`, polyfill as much of it as we can.
    if (nativeEvent.type === 'keypress') {
        const charCode = getEventCharCode(nativeEvent);
        // The enter-key is technically both printable and non-printable and can
        // thus be captured by `keypress`, no other non-printable key should.
        return charCode === 13 ? 'Enter' : String.fromCharCode(charCode);
    }
    if (nativeEvent.type === 'keydown' || nativeEvent.type === 'keyup') {
        // While user keyboard layout determines the actual meaning of each
        // `keyCode` value, almost all function keys have a universal value.
        return translateToKey[nativeEvent.keyCode!] || 'Unidentified';
    }
    return '';
}
/**
 * Translation from modifier key to the associated property in the event.
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#keys-Modifiers
 */
const modifierKeyToProp: Readonly<Record<string, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {
    Alt: 'altKey',
    Control: 'ctrlKey',
    Meta: 'metaKey',
    Shift: 'shiftKey',
};
// Older browsers (Safari <= 10, iOS Safari <= 10.2) do not support
// getModifierState. If getModifierState is not supported, we map it to a set of
// modifier keys exposed by the event. In this case, Lock-keys are not supported.
function modifierStateGetter(nativeEvent: NativeEventFields, keyArg: string) {
    if (nativeEvent.getModifierState) {
        return nativeEvent.getModifierState(keyArg);
    }
    const keyProp = modifierKeyToProp[keyArg];
    return keyProp ? !!nativeEvent[keyProp] : false;
}
// Upstream shares one `this`-reading getter across events; here each event gets a closure over its own
// native event (a compiled function has no dynamic `this`).
function getEventModifierState(nativeEvent: NativeEventFields) {
    return (keyArg: string) => modifierStateGetter(nativeEvent, keyArg);
}
/**
 * @interface KeyboardEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const KeyboardEventInterface: EventInterfaceType = extendInterface(UIEventInterface, {
    key: getEventKey,
    code: 0,
    location: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    locale: 0,
    getModifierState: getEventModifierState,
    // Legacy Interface
    charCode: function (event: NativeEventFields) {
        // `charCode` is the result of a KeyPress event and represents the value of
        // the actual printable character.
        // KeyPress is deprecated, but its replacement is not yet final and not
        // implemented in any major browser. Only KeyPress has charCode.
        if (event.type === 'keypress') {
            return getEventCharCode(event);
        }
        return 0;
    },
    keyCode: function (event: NativeEventFields) {
        // `keyCode` is the result of a KeyDown/Up event and represents the value of
        // physical keyboard key.
        // The actual meaning of the value depends on the users' keyboard layout
        // which cannot be detected. Assuming that it is a US keyboard layout
        // provides a surprisingly accurate mapping for US and European users.
        // Due to this, it is left to the user to implement at this time.
        if (event.type === 'keydown' || event.type === 'keyup') {
            return event.keyCode;
        }
        return 0;
    },
    which: function (event: NativeEventFields) {
        // `which` is an alias for either `keyCode` or `charCode` depending on the
        // type of the event.
        if (event.type === 'keypress') {
            return getEventCharCode(event);
        }
        if (event.type === 'keydown' || event.type === 'keyup') {
            return event.keyCode;
        }
        return 0;
    },
});
export class SyntheticKeyboardEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return KeyboardEventInterface;
    }
}
/**
 * @interface PointerEvent
 * @see http://www.w3.org/TR/pointerevents/
 */
const PointerEventInterface: EventInterfaceType = extendInterface(MouseEventInterface, {
    pointerId: 0,
    width: 0,
    height: 0,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 0,
    isPrimary: 0,
});
export class SyntheticPointerEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return PointerEventInterface;
    }
}
/**
 * @interface TouchEvent
 * @see http://www.w3.org/TR/touch-events/
 */
const TouchEventInterface: EventInterfaceType = extendInterface(UIEventInterface, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: getEventModifierState,
});
export class SyntheticTouchEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return TouchEventInterface;
    }
}
/**
 * @interface Event
 * @see http://www.w3.org/TR/2009/WD-css3-transitions-20090320/#transition-events-
 * @see https://developer.mozilla.org/en-US/docs/Web/API/TransitionEvent
 */
const TransitionEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    propertyName: 0,
    elapsedTime: 0,
    pseudoElement: 0,
});
export class SyntheticTransitionEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return TransitionEventInterface;
    }
}
/**
 * @interface WheelEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const WheelEventInterface: EventInterfaceType = extendInterface(MouseEventInterface, {
    deltaX(event: NativeEventFields) {
        return 'deltaX' in event
            ? event.deltaX
            : // Fallback to `wheelDeltaX` for Webkit and normalize (right is positive).
                'wheelDeltaX' in event
                    ? -event.wheelDeltaX!
                    : 0;
    },
    deltaY(event: NativeEventFields) {
        return 'deltaY' in event
            ? event.deltaY
            : // Fallback to `wheelDeltaY` for Webkit and normalize (down is positive).
                'wheelDeltaY' in event
                    ? -event.wheelDeltaY!
                    : // Fallback to `wheelDelta` for IE<9 and normalize (down is positive).
                        'wheelDelta' in event
                            ? -event.wheelDelta!
                            : 0;
    },
    deltaZ: 0,
    // Browsers without "deltaMode" is reporting in raw wheel delta where one
    // notch on the scroll is always +/- 120, roughly equivalent to pixels.
    // A good approximation of DOM_DELTA_LINE (1) is 5% of viewport size or
    // ~40 pixels, for DOM_DELTA_SCREEN (2) it is 87.5% of viewport size.
    deltaMode: 0,
});
export class SyntheticWheelEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return WheelEventInterface;
    }
}
const ToggleEventInterface: EventInterfaceType = extendInterface(EventInterface, {
    newState: 0,
    oldState: 0,
});
export class SyntheticToggleEvent extends SyntheticBaseEvent {
    eventInterface(): EventInterfaceType {
        return ToggleEventInterface;
    }
}
