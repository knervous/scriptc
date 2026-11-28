/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { AsyncDispatcher, CacheAbortSignal, Fiber } from './ReactInternalTypes';
import type { Cache } from './ReactFiberCacheComponent';
import { readContext } from './ReactFiberNewContext';
import { CacheContext } from './ReactFiberCacheComponent';
function getCacheForType<T>(resourceType: () => T): T {
    const cache: Cache = readContext(CacheContext)!;
    let cacheForType: T | undefined = (cache.data.get(resourceType) as T | undefined);
    if (cacheForType === undefined) {
        cacheForType = resourceType();
        cache.data.set(resourceType, cacheForType);
    }
    return cacheForType;
}
function cacheSignal(): null | CacheAbortSignal {
    const cache: Cache = readContext(CacheContext)!;
    return cache.controller.signal;
}
export const DefaultAsyncDispatcher: AsyncDispatcher = {
    getCacheForType,
    cacheSignal,
};
;
