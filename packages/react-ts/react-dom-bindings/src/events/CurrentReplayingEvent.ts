/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { AnyNativeEvent } from '../events/PluginModuleType';
// This exists to avoid circular dependency between ReactDOMEventReplaying
// and DOMPluginEventSystem.
let currentReplayingEvent: AnyNativeEvent | null = null;
export function setReplayingEvent(event: AnyNativeEvent): void {
    ;
    currentReplayingEvent = event;
}
export function resetReplayingEvent(): void {
    ;
    currentReplayingEvent = null;
}
export function isReplayingEvent(event: AnyNativeEvent): boolean {
    return event === currentReplayingEvent;
}
