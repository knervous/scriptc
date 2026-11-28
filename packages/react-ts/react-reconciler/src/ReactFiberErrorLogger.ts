/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import reportGlobalError from 'shared/reportGlobalError';
import type { CapturedValue } from './ReactCapturedValue';
import type { Fiber,FiberRoot } from './ReactInternalTypes';
import { ClassComponent } from './ReactWorkTags';
export function defaultOnUncaughtError(error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}): void {
    // Overriding this can silence these warnings e.g. for tests.
    // See https://github.com/facebook/react/pull/13384
    // For uncaught root errors we report them as uncaught to the browser's
    // onerror callback. This won't have component stacks and the error addendum.
    // So we add those into a separate console.warn.
    reportGlobalError(error);
    ;
}
export function defaultOnCaughtError(error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
    readonly errorBoundary?: object | null | undefined; // the boundary class instance
}): void {
    // Overriding this can silence these warnings e.g. for tests.
    // See https://github.com/facebook/react/pull/13384
    {
        // In production, we print the error directly.
        // This will include the message, the JS stack, and anything the browser wants to show.
        // We pass the error object instead of custom message so that the browser displays the error natively.
        console['error'](error); // Don't transform to our wrapper, however, React DevTools can still add a stack.
    }
}
export function defaultOnRecoverableError(error: unknown, errorInfo: {
    readonly componentStack?: string | null | undefined;
}) {
    reportGlobalError(error);
}
export function logUncaughtError(root: FiberRoot, errorInfo: CapturedValue<unknown>): void {
    try {
        ;
        const error = (errorInfo.value);
        ;
        const onUncaughtError = root.onUncaughtError;
        onUncaughtError(error, {
            componentStack: errorInfo.stack,
        });
    }
    catch (e: unknown) {
        // This method must not throw, or React internal state will get messed up.
        // If console.error is overridden, or logCapturedError() shows a dialog that throws,
        // we want to report this error outside of the normal stack as a last resort.
        // https://github.com/facebook/react/issues/13188
        setTimeout(() => {
            throw e;
        });
    }
}
export function logCaughtError(root: FiberRoot, boundary: Fiber, errorInfo: CapturedValue<unknown>): void {
    try {
        ;
        const error = (errorInfo.value);
        const onCaughtError = root.onCaughtError;
        onCaughtError(error, {
            componentStack: errorInfo.stack,
            errorBoundary: boundary.tag === ClassComponent
                ? boundary.stateNode // This should always be the case as long as we only have class boundaries
                : null,
        });
    }
    catch (e: unknown) {
        // This method must not throw, or React internal state will get messed up.
        // If console.error is overridden, or logCapturedError() shows a dialog that throws,
        // we want to report this error outside of the normal stack as a last resort.
        // https://github.com/facebook/react/issues/13188
        setTimeout(() => {
            throw e;
        });
    }
}
