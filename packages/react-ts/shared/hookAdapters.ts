/**
 * Adapters between the public, generic hook signatures and the erased dispatcher (react-reconciler
 * ReactInternalTypes.Dispatcher), where user values travel as `unknown`.
 *
 * A user callback whose parameters carry the user's types (a reducer, an action, a ref callback) is wrapped once; the
 * wrapper is cached per callback, so a callback React compares by identity (effect deps, `action !== prevAction`)
 * keeps one stable wrapper.
 */
import type { HookReducer } from 'react-reconciler/src/ReactInternalTypes';

const reducerAdapters: WeakMap<object, HookReducer> = new WeakMap();
const refAdapters: WeakMap<object, (instance: unknown) => unknown> = new WeakMap();
const unaryAdapters: WeakMap<object, (value: unknown) => unknown> = new WeakMap();

export function adaptReducer<S, A, R>(reducer: (state: S, action: A) => R): HookReducer {
    let adapter = reducerAdapters.get(reducer);
    if (adapter === undefined) {
        adapter = (state: unknown, action: unknown) => reducer(state as S, action as A);
        reducerAdapters.set(reducer, adapter);
    }
    return adapter;
}

export function adaptRefCallback<T>(ref: (instance: T | null) => unknown): (instance: unknown) => unknown {
    let adapter = refAdapters.get(ref);
    if (adapter === undefined) {
        adapter = (instance: unknown) => ref(instance as T | null);
        refAdapters.set(ref, adapter);
    }
    return adapter;
}

export function adaptUnary<V, R>(fn: (value: V) => R): (value: unknown) => unknown {
    let adapter = unaryAdapters.get(fn);
    if (adapter === undefined) {
        adapter = (value: unknown) => fn(value as V);
        unaryAdapters.set(fn, adapter);
    }
    return adapter;
}
