/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The Navigation API surface this module uses, under its own names (TypeScript's DOM lib has it only in newer versions).
interface ReactNavigateEvent extends Event {
    readonly canIntercept: boolean;
    readonly info: unknown;
    intercept(options: {
        handler(): Promise<void>;
        focusReset: 'manual';
        scroll: 'manual';
    }): void;
}
interface ReactNavigationHistoryEntry {
    readonly url: string | null;
    getState(): unknown;
}
interface ReactNavigation {
    readonly transition: object | null;
    readonly currentEntry: ReactNavigationHistoryEntry | null;
    navigate(url: string, options: {
        state: unknown;
        info: unknown;
        history: 'replace';
    }): unknown;
    addEventListener(type: 'navigate', listener: (event: ReactNavigateEvent) => void): void;
    addEventListener(type: 'navigatesuccess' | 'navigateerror', listener: () => void): void;
    removeEventListener(type: 'navigate', listener: (event: ReactNavigateEvent) => void): void;
    removeEventListener(type: 'navigatesuccess' | 'navigateerror', listener: () => void): void;
}
// The global `navigation`, read on each use as the JavaScript build does.
function navigationGlobal(): unknown {
    return (globalThis as Readonly<Record<string, unknown>>).navigation;
}
export function defaultOnDefaultTransitionIndicator(): undefined | (() => void) {
    if (typeof navigationGlobal() !== 'object') {
        // If the Navigation API is not available, then this is a noop.
        return;
    }
    let isCancelled = false;
    let pendingResolve: null | (() => void) = null;
    function handleNavigate(event: ReactNavigateEvent) {
        if (event.canIntercept && event.info === 'react-transition') {
            event.intercept({
                handler() {
                    return new Promise<void>((resolve) => (pendingResolve = resolve));
                },
                focusReset: 'manual',
                scroll: 'manual',
            });
        }
    }
    function handleNavigateComplete() {
        if (pendingResolve !== null) {
            // If this was not our navigation completing, we were probably cancelled.
            // We'll start a new one below.
            pendingResolve();
            pendingResolve = null;
        }
        if (!isCancelled) {
            // Some other navigation completed but we should still be running.
            // Start another fake one to keep the loading indicator going.
            // There needs to be an async gap to work around https://issues.chromium.org/u/1/issues/419746417.
            setTimeout(startFakeNavigation, 20);
        }
    }
    (navigationGlobal() as ReactNavigation).addEventListener('navigate', handleNavigate);
    (navigationGlobal() as ReactNavigation).addEventListener('navigatesuccess', handleNavigateComplete);
    (navigationGlobal() as ReactNavigation).addEventListener('navigateerror', handleNavigateComplete);
    function startFakeNavigation() {
        if (isCancelled) {
            // We already stopped this Transition.
            return;
        }
        if ((navigationGlobal() as ReactNavigation).transition) {
            // There is an on-going Navigation already happening. Let's wait for it to
            // finish before starting our fake one.
            return;
        }
        // Trigger a fake navigation to the same page
        const currentEntry = (navigationGlobal() as ReactNavigation).currentEntry;
        if (currentEntry && currentEntry.url != null) {
            (navigationGlobal() as ReactNavigation).navigate(currentEntry.url, {
                state: currentEntry.getState(),
                info: 'react-transition',
                history: 'replace',
            });
        }
    }
    // Delay the start a bit in case this is a fast Transition.
    setTimeout(startFakeNavigation, 100);
    return function () {
        isCancelled = true;
        (navigationGlobal() as ReactNavigation).removeEventListener('navigate', handleNavigate);
        (navigationGlobal() as ReactNavigation).removeEventListener('navigatesuccess', handleNavigateComplete);
        (navigationGlobal() as ReactNavigation).removeEventListener('navigateerror', handleNavigateComplete);
        if (pendingResolve !== null) {
            pendingResolve();
            pendingResolve = null;
        }
    };
}
