/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ReactContext } from 'shared/ReactTypes';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import { pushProvider, popProvider } from './ReactFiberNewContext';
// React destructures the namespace (for Rollup's CommonJS interop); a named import binds the same values.
import { unstable_scheduleCallback as scheduleCallback, unstable_NormalPriority as NormalPriority } from 'scheduler';
import type { ShimAbortSignal } from './ReactInternalTypes';
// In environments without AbortController (e.g. tests)
// replace it with a lightweight shim that only has the features we use.
class AbortControllerShim {
    signal: ShimAbortSignal;
    abort: () => void;
    constructor() {
        const listeners: Array<() => void> = [];
        const signal: ShimAbortSignal = (this.signal = {
            aborted: (false as boolean),
            addEventListener: (type: 'abort', listener: () => void) => {
                listeners.push(listener);
            },
        });
        this.abort = () => {
            signal.aborted = true;
            listeners.forEach((listener) => listener());
        };
    }
}
// The platform's controller, or the shim: one of two concrete types, never a structural view of both.
type CacheAbortController = AbortController | AbortControllerShim;
// React's `new AbortControllerLocal()`: the platform's AbortController, or the shim where there is none.
function createAbortController(): CacheAbortController {
    return typeof AbortController !== 'undefined' ? new AbortController() : new AbortControllerShim();
}
export type Cache = {
    controller: CacheAbortController;
    data: Map<() => unknown, unknown>;
    refCount: number;
};
export type CacheComponentState = {
    readonly parent: Cache;
    readonly cache: Cache;
};
export type SpawnedCachePool = {
    readonly parent: Cache;
    readonly pool: Cache;
};
// Intentionally not named imports because Rollup would
// use dynamic dispatch for CommonJS interop named imports.
// Null until the root provides a cache.
export const CacheContext: ReactContext<Cache | null> = {
    $$typeof: REACT_CONTEXT_TYPE,
    // We don't use Consumer/Provider for Cache components. So we'll cheat.
    Consumer: null,
    Provider: null,
    // We'll initialize these at the root.
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0,
};
;
// Creates a new empty Cache instance with a ref-count of 0. The caller is responsible
// for retaining the cache once it is in use (retainCache), and releasing the cache
// once it is no longer needed (releaseCache).
export function createCache(): Cache {
    return {
        controller: createAbortController(),
        data: new Map(),
        refCount: 0,
    };
}
export function retainCache(cache: Cache) {
    ;
    cache.refCount++;
}
// Cleanup a cache instance, potentially freeing it if there are no more references
export function releaseCache(cache: Cache) {
    cache.refCount--;
    ;
    if (cache.refCount === 0) {
        scheduleCallback(NormalPriority, () => {
            cache.controller.abort();
        });
    }
}
export function pushCacheProvider(workInProgress: Fiber, cache: Cache) {
    pushProvider(workInProgress, CacheContext, cache);
}
export function popCacheProvider(workInProgress: Fiber, cache: Cache) {
    popProvider(CacheContext, workInProgress);
}
