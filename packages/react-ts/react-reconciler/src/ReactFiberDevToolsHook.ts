/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { EventPriority } from './ReactEventPriorities';
import { DidCapture } from './ReactFiberFlags';
import type { Fiber,FiberRoot } from './ReactInternalTypes';
import { log,unstable_setDisableYieldValue } from './Scheduler';
// The part of the React DevTools global hook the reconciler calls.
type DevToolsHook = {
    isDisabled?: boolean;
    supportsFiber?: boolean;
    checkDCE?: unknown;
    inject(internals: object): number;
    onCommitFiberRoot?: (rendererID: number | null, root: FiberRoot, schedulerPriority: unknown, didError: boolean) => void;
    onPostCommitFiberRoot?: (rendererID: number | null, root: FiberRoot) => void;
    onCommitFiberUnmount?: (rendererID: number | null, fiber: Fiber) => void;
    setStrictMode?: (rendererID: number | null, newIsStrictMode: boolean) => void;
};
declare var __REACT_DEVTOOLS_GLOBAL_HOOK__: DevToolsHook | undefined;
let rendererID: number | null = null;
let injectedHook: DevToolsHook | null = null;
export const isDevToolsPresent = typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';
export function injectInternals(internals: object): boolean {
    if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
        // No DevTools
        return false;
    }
    const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook.isDisabled) {
        // This isn't a real property on the hook, but it can be set to opt out
        // of DevTools integration and associated warnings and logs.
        // https://github.com/facebook/react/issues/3877
        return true;
    }
    if (!hook.supportsFiber) {
        ;
        // DevTools exists, even though it doesn't support Fiber.
        return true;
    }
    try {
        rendererID = hook.inject(internals);
        // We have successfully injected, so now it is safe to set up hooks.
        injectedHook = hook;
    }
    catch (err: unknown) {
        ;
    }
    if (hook.checkDCE) {
        // This is the real DevTools.
        return true;
    }
    else {
        // This is likely a hook installed by Fast Refresh runtime.
        return false;
    }
}
export function onCommitRoot(root: FiberRoot, eventPriority: EventPriority) {
    if (injectedHook && typeof injectedHook.onCommitFiberRoot === 'function') {
        try {
            const didError = (root.current.flags & DidCapture) === DidCapture;
            {
                injectedHook.onCommitFiberRoot(rendererID, root, undefined, didError);
            }
        }
        catch (err: unknown) {
            ;
        }
    }
}
export function onPostCommitRoot(root: FiberRoot) {
    if (injectedHook &&
        typeof injectedHook.onPostCommitFiberRoot === 'function') {
        try {
            injectedHook.onPostCommitFiberRoot(rendererID, root);
        }
        catch (err: unknown) {
            ;
        }
    }
}
export function onCommitUnmount(fiber: Fiber) {
    if (injectedHook && typeof injectedHook.onCommitFiberUnmount === 'function') {
        try {
            injectedHook.onCommitFiberUnmount(rendererID, fiber);
        }
        catch (err: unknown) {
            ;
        }
    }
}
export function setIsStrictModeForDevtools(newIsStrictMode: boolean) {
    if (typeof log === 'function') {
        // We're in a test because Scheduler.log only exists
        // in SchedulerMock. To reduce the noise in strict mode tests,
        // suppress warnings and disable scheduler yielding during the double render
        unstable_setDisableYieldValue!(newIsStrictMode);
    }
    if (injectedHook && typeof injectedHook.setStrictMode === 'function') {
        try {
            injectedHook.setStrictMode(rendererID, newIsStrictMode);
        }
        catch (err: unknown) {
            ;
        }
    }
}
