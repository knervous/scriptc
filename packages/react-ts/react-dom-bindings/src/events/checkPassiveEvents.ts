/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { canUseDOM } from 'shared/ExecutionEnvironment';
export let passiveBrowserEventsSupported: boolean = false;
// Check if browser support events with passive listeners
// https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
class PassiveProbe {
    capture: boolean | undefined = undefined;
    // The probe object doubles as the listener (never dispatched).
    handleEvent(): void { }
    get passive(): boolean | undefined {
        passiveBrowserEventsSupported = true;
        return undefined;
    }
}
if (canUseDOM) {
    try {
        // The probe object doubles as the listener (never dispatched), so it carries a no-op `handleEvent`.
        // The browser reads `passive` with [[Get]]; React defines the getter on the probe object with
        // Object.defineProperty, here it is the probe class's accessor (found the same way). `capture` reads undefined
        // on both.
        const options = new PassiveProbe();
        window.addEventListener('test', options, options);
        window.removeEventListener('test', options, options);
    }
    catch (e) {
        passiveBrowserEventsSupported = false;
    }
}
