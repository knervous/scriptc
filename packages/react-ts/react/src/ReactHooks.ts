/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Dispatcher } from 'react-reconciler/src/ReactInternalTypes';
import type { ReactContext, StartTransitionOptions, Usable, Awaited, } from 'shared/ReactTypes';
import { REACT_CONSUMER_TYPE } from 'shared/ReactSymbols';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import { adaptReducer, adaptRefCallback, adaptUnary } from 'shared/hookAdapters';
type BasicStateAction<S> = ((arg1: S) => S) | S;
type Dispatch<A> = (arg1: A) => void;
function resolveDispatcher() {
    const dispatcher = ReactSharedInternals.H;
    ;
    // Will result in a null access error if accessed outside render phase. We
    // intentionally don't throw our own error because this is in a hot path.
    // Also helps ensure this is inlined.
    return dispatcher as Dispatcher;
}
export function getCacheForType<T>(resourceType: () => T): T {
    const dispatcher = ReactSharedInternals.A;
    if (!dispatcher) {
        // If there is no dispatcher, then we treat this as not being cached.
        return resourceType();
    }
    return dispatcher.getCacheForType(resourceType);
}
export function useContext<T>(Context: ReactContext<T>): T {
    const dispatcher = resolveDispatcher();
    ;
    return dispatcher.useContext(Context) as T;
}
export function useState<S>(initialState: (() => S) | S): [
    S,
    Dispatch<BasicStateAction<S>>
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useState(initialState) as [
        S,
        Dispatch<BasicStateAction<S>>
    ];
}
export function useReducer<S, I, A>(reducer: (arg1: S, arg2: A) => S, initialArg: I, init?: (arg1: I) => S): [
    S,
    Dispatch<A>
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useReducer(adaptReducer(reducer), initialArg, init === undefined ? undefined : adaptUnary(init)) as [
        S,
        Dispatch<A>
    ];
}
export function useRef<T>(initialValue: T): {
    current: T;
} {
    const dispatcher = resolveDispatcher();
    return dispatcher.useRef(initialValue) as {
        current: T;
    };
}
export function useEffect(create: () => (() => void) | undefined, deps?: Array<unknown> | null): void {
    ;
    const dispatcher = resolveDispatcher();
    return dispatcher.useEffect(create, deps);
}
export function useInsertionEffect(create: () => (() => void) | undefined, deps?: Array<unknown> | null): void {
    ;
    const dispatcher = resolveDispatcher();
    return dispatcher.useInsertionEffect(create, deps);
}
export function useLayoutEffect(create: () => (() => void) | undefined, deps?: Array<unknown> | null): void {
    ;
    const dispatcher = resolveDispatcher();
    return dispatcher.useLayoutEffect(create, deps);
}
export function useCallback<T>(callback: T, deps?: Array<unknown> | null): T {
    const dispatcher = resolveDispatcher();
    return dispatcher.useCallback(callback, deps) as T;
}
export function useMemo<T>(create: () => T, deps?: Array<unknown> | null): T {
    const dispatcher = resolveDispatcher();
    return dispatcher.useMemo(create, deps) as T;
}
export function useImperativeHandle<T>(ref: {
    current: T | null;
} | ((inst: T | null) => unknown) | null | undefined, create: () => T, deps?: Array<unknown> | null): void {
    const dispatcher = resolveDispatcher();
    return dispatcher.useImperativeHandle(typeof ref === 'function' ? adaptRefCallback(ref) : ref, create, deps);
}
export function useDebugValue<T>(value: T, formatterFn?: ((value: T) => unknown) | null): void {
    ;
}
export function useTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useTransition();
}
export function useDeferredValue<T>(value: T, initialValue?: T): T {
    const dispatcher = resolveDispatcher();
    return dispatcher.useDeferredValue(value, initialValue) as T;
}
export function useId(): string {
    const dispatcher = resolveDispatcher();
    return dispatcher.useId();
}
export function useSyncExternalStore<T>(subscribe: (arg1: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T {
    const dispatcher = resolveDispatcher();
    return dispatcher.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) as T;
}
export function useCacheRefresh(): <T>(arg1?: (() => T) | null | undefined, arg2?: T | null | undefined) => void {
    const dispatcher = resolveDispatcher();
    return dispatcher.useCacheRefresh();
}
export function use<T>(usable: Usable<T>): T {
    const dispatcher = resolveDispatcher();
    return dispatcher.use(usable) as T;
}
export function useMemoCache(size: number): Array<unknown> {
    const dispatcher = resolveDispatcher();
    return dispatcher.useMemoCache(size);
}
export function useEffectEvent<Args, F extends (...rest: Array<Args>) => unknown>(callback: F): F {
    const dispatcher = resolveDispatcher();
    return dispatcher.useEffectEvent!(callback as (...args: Array<unknown>) => unknown) as F;
}
export function useOptimistic<S, A>(passthrough: S, reducer?: ((arg1: S, arg2: A) => S) | null): [
    S,
    (arg1: A) => void
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useOptimistic(passthrough, reducer == null ? reducer : adaptReducer(reducer)) as [
        S,
        (arg1: A) => void
    ];
}
export function useActionState<S, P>(action: (arg1: Awaited<S>, arg2: P) => S, initialState: Awaited<S>, permalink?: string): [
    Awaited<S>,
    (arg1: P) => void,
    boolean
] {
    const dispatcher = resolveDispatcher();
    return dispatcher.useActionState(adaptReducer(action), initialState, permalink) as [
        Awaited<S>,
        (arg1: P) => void,
        boolean
    ];
}
