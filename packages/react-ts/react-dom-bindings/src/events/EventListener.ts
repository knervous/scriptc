/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// A listener as a plain function type (the DOM's EventListener interface would make a compiled function a page value).
export type NativeListener = (event: Event) => void;
import { type DomNode, LISTEN_ACTIVE, LISTEN_CAPTURE, LISTEN_PASSIVE, listen } from 'dom-stream/dom';
// Every target is a bridge node (dom-stream): its listeners go through the DOM stream (dom-stream's listen): the page forwards each event to the compiled listener.
export function addEventBubbleListener(target: DomNode, eventType: string, listener: NativeListener): NativeListener {
    listen(target, eventType, listener, 0);
    return listener;
}
export function addEventCaptureListener(target: DomNode, eventType: string, listener: NativeListener): NativeListener {
    listen(target, eventType, listener, LISTEN_CAPTURE);
    return listener;
}
export function addEventCaptureListenerWithPassiveFlag(target: DomNode, eventType: string, listener: NativeListener, passive: boolean): NativeListener {
    listen(target, eventType, listener, LISTEN_CAPTURE | (passive ? LISTEN_PASSIVE : LISTEN_ACTIVE));
    return listener;
}
export function addEventBubbleListenerWithPassiveFlag(target: DomNode, eventType: string, listener: NativeListener, passive: boolean): NativeListener {
    listen(target, eventType, listener, passive ? LISTEN_PASSIVE : LISTEN_ACTIVE);
    return listener;
}
