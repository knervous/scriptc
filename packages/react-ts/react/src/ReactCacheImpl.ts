/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import ReactSharedInternals from 'shared/ReactSharedInternals';
type UnterminatedCacheNode<T> = {
    s: 0;
    v: undefined;
    o: null | WeakMap<Function | Record<any, any>, CacheNode<T>>;
    p: null | Map<string | number | null | undefined | symbol | boolean, CacheNode<T>>;
};
type TerminatedCacheNode<T> = {
    s: 1;
    v: T;
    o: null | WeakMap<Function | Record<any, any>, CacheNode<T>>;
    p: null | Map<string | number | null | undefined | symbol | boolean, CacheNode<T>>;
};
type ErroredCacheNode<T> = {
    s: 2;
    v: unknown;
    o: null | WeakMap<Function | Record<any, any>, CacheNode<T>>;
    p: null | Map<string | number | null | undefined | symbol | boolean, CacheNode<T>>;
};
type CacheNode<T> = TerminatedCacheNode<T> | UnterminatedCacheNode<T> | ErroredCacheNode<T>;
