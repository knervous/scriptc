/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
// Node's `process` global, read off the global object (`typeof process` is 'undefined' in a browser page).
function nodeProcess(): unknown {
    return readProperty(globalThis, 'process');
}
const reportGlobalError: (error: unknown) => void = typeof reportError === 'function'
    ? // In modern browsers, reportError will dispatch an error event,
        // emulating an uncaught JavaScript error. (A closure of the declared type, like the fallback.)
        (error: unknown) => reportError(error)
    : (error: unknown) => {
        if (typeof window === 'object' &&
            typeof window.ErrorEvent === 'function') {
            // Browser Polyfill
            const message = typeof error === 'object' &&
                error !== null &&
                typeof readProperty(error as object, 'message') === 'string'
                ? // eslint-disable-next-line react-internal/safe-string-coercion
                    String(readProperty(error as object, 'message'))
                : // eslint-disable-next-line react-internal/safe-string-coercion
                    String(error);
            const event = new window.ErrorEvent('error', {
                bubbles: true,
                cancelable: true,
                message: message,
                error: error,
            });
            const shouldLog = window.dispatchEvent(event);
            if (!shouldLog) {
                return;
            }
        }
        else if (typeof nodeProcess() === 'object' &&
            typeof readProperty(nodeProcess() as object, 'emit') === 'function') {
            // Node Polyfill
            (readProperty(nodeProcess() as object, 'emit') as (event: string, value: unknown) => unknown).call(nodeProcess(), 'uncaughtException', error);
            return;
        }
        console['error'](error);
    };
export default reportGlobalError;
