/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Dispatcher } from 'react-reconciler/src/ReactInternalTypes';
import type { AsyncDispatcher } from 'react-reconciler/src/ReactInternalTypes';
import type { Transition } from './ReactStartTransition';
import type { GestureProvider, GestureOptions } from 'shared/ReactTypes';
import { enableGestureTransition } from 'shared/ReactFeatureFlags';
type onStartTransitionFinish = (arg1: Transition, arg2: unknown) => void;
// The production client's shared internals: React creates exactly these four (the other fields of its Flow type are
// development builds' and act()'s, never touched here).
export type SharedStateClient = {
    H: null | Dispatcher; // ReactCurrentDispatcher for Hooks;
    A: null | AsyncDispatcher; // ReactCurrentCache for Cache;
    T: null | Transition; // ReactCurrentBatchConfig for Transitions;
    S: null | onStartTransitionFinish;
};
export type RendererTask = (arg1: boolean) => RendererTask | null;
const ReactSharedInternals: SharedStateClient = {
    H: null,
    A: null,
    T: null,
    S: null,
};
;
;
export default ReactSharedInternals;
