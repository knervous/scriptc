/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { TEXT_NODE } from '../client/HTMLNodeType';
/**
 * Gets the target node from a native browser event by accounting for
 * inconsistencies in browser DOM APIs.
 *
 * @param {object} nativeEvent Native browser event.
 * @return {DOMEventTarget} Target node.
 */
/** An event target with the DOM Node members the normalization below reads. */
interface NativeEventTarget extends EventTarget {
    correspondingUseElement?: NativeEventTarget;
    nodeType?: number;
    parentNode?: NativeEventTarget | null;
}
function getEventTarget(nativeEvent: Event): Node {
    // Fallback to nativeEvent.srcElement for IE9
    // https://github.com/facebook/react/issues/12506
    let target: NativeEventTarget = nativeEvent.target || nativeEvent.srcElement || window;
    // Normalize SVG <use> element events #4963
    if (target.correspondingUseElement) {
        target = target.correspondingUseElement;
    }
    // Safari may fire events on text nodes (Node.TEXT_NODE is 3).
    // @see http://www.quirksmode.org/js/events_properties.html
    // Flow typed the result as a plain target; every caller treats it as a Node (the `window` fallback
    // only happens for an event that has no target at all).
    return (target.nodeType === TEXT_NODE ? target.parentNode : target) as Node;
}
export default getEventTarget;
