/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { DOMEventName } from '../events/DOMEventNames';
export type ReactDOMEventHandleListener = {
    callback: (event: unknown) => unknown; // called with the synthetic event, like a props handler
    capture: boolean;
    type: DOMEventName;
};
