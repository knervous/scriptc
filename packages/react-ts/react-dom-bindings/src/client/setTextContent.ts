/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { DomElement } from 'dom-stream/dom';
/**
 * Set the textContent property of a node. For text updates, it's faster
 * to set the `nodeValue` of the Text node directly instead of using
 * `.textContent` which will remove the existing node and create a new one.
 *
 * @param {DOMElement} node
 * @param {string} text
 * @internal
 */
// The page keeps a lone text child's node as React DOM does here in the JavaScript build (dom-stream's dom-host.js setTextContent).
function setTextContent(node: DomElement, text: string): void {
    node.setTextContent(text);
}
export default setTextContent;
