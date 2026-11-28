/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { TransitionTypes } from 'react/src/ReactTransitionType';
// Store all types while we're entangled with an async Transition.
export let entangledTransitionTypes: null | TransitionTypes = null;
export function clearEntangledAsyncTransitionTypes() {
    // Called when all Async Actions are done.
    entangledTransitionTypes = null;
}
