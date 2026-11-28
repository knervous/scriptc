/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Transition } from 'react/src/ReactStartTransition';
import type { OffscreenInstance } from './ReactFiberOffscreenComponent';
import type { StackCursor } from './ReactFiberStack';
import { createCursor } from './ReactFiberStack';
import type { Fiber } from './ReactInternalTypes';
export type SuspenseInfo = {
    name: string | null;
};
// TODO: Is there a way to not include the tag or name here?
export type TracingMarkerInstance = {
    tag?: TracingMarkerTag;
    transitions: Set<Transition> | null;
    pendingBoundaries: PendingBoundaries | null;
    aborts: Array<TransitionAbort> | null;
    name: string | null;
};
export type TransitionAbort = {
    reason: 'error' | 'unknown' | 'marker' | 'suspense';
    name?: string | null;
};
export type TracingMarkerTag = 0 | 1;
export type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;
// For every tracing marker, store a pointer to it. We will later access it
// to get the set of suspense boundaries that need to resolve before the
// tracing marker can be logged as complete
// This code lives separate from the ReactFiberTransition code because
// we push and pop on the tracing marker, not the suspense boundary
const markerInstanceStack: StackCursor<Array<TracingMarkerInstance> | null> = createCursor<Array<TracingMarkerInstance> | null>(null);
export function popRootMarkerInstance(workInProgress: Fiber) {
    ;
}
export function popMarkerInstance(workInProgress: Fiber): void {
    ;
}
