/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { batchedUpdates as batchedUpdatesImpl,flushSyncWork } from 'react-reconciler/src/ReactFiberReconciler';
import { needsStateRestore,restoreStateIfNeeded } from './ReactDOMControlledComponent';
// Used as a way to call batchedUpdates when we don't have a reference to
// the renderer. Such as when we're dispatching events or if third party
// libraries need to call batchedUpdates. Eventually, this API will go away when
// everything is batched by default. We'll then have a similar API to opt-out of
// scheduled work and instead do synchronous work.
let isInsideEventHandler = false;
function finishEventHandler() {
    // Here we wait until all updates have propagated, which is important
    // when using controlled components within layers:
    // https://github.com/facebook/react/issues/1698
    // Then we restore state of any controlled component.
    const controlledComponentsHavePendingUpdates = needsStateRestore();
    if (controlledComponentsHavePendingUpdates) {
        // If a controlled event was fired, we may need to restore the state of
        // the DOM node back to the controlled value. This is necessary when React
        // bails out of the update without touching the DOM.
        // TODO: Restore state in the microtask, after the discrete updates flush,
        // instead of early flushing them here.
        // @TODO Should move to flushSyncWork once legacy mode is removed but since this flushSync
        // flushes passive effects we can't do this yet.
        flushSyncWork();
        restoreStateIfNeeded();
    }
}
export function batchedUpdates<R>(fn: () => R): R;
export function batchedUpdates<A, R>(fn: (a: A) => R, a: A): R;
export function batchedUpdates<A, B, R>(fn: (a: A, b: B) => R, a: A, b: B): R;
export function batchedUpdates(fn: (a?: unknown, b?: unknown) => unknown, a?: unknown, b?: unknown): unknown {
    if (isInsideEventHandler) {
        // If we are currently inside another batch, we need to wait until it
        // fully completes before restoring state.
        return fn(a, b);
    }
    isInsideEventHandler = true;
    try {
        // (The reconciler's batchedUpdates takes one argument and ignores any other.)
        return batchedUpdatesImpl(fn, a);
    }
    finally {
        isInsideEventHandler = false;
        finishEventHandler();
    }
}
