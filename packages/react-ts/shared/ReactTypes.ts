/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// React's Flow type also lists the legacy ReactProvider/ReactConsumer element shapes; at run time those are
// ordinary elements (React.ReactElement), so they are not separate arms here.
export type ReactNode = React.ReactElement<any> | ReactPortal | ReactText | ReactFragment;
export type ReactEmpty = null | undefined | boolean;
export type ReactFragment = ReactEmpty | Iterable<React.ReactNode>;
// Children: any value; React inspects it at run time (strings, numbers, elements, portals, iterables, thenables,
// lazy components). React's Flow type is `ReactEmpty | React$Node`; as a recursive union through Iterable it has no
// compiled representation, so it is unknown here.
export type ReactNodeList = unknown;
export type ReactText = string | number;
export type ReactConsumerType<T> = {
    $$typeof: symbol | number;
    _context: ReactContext<T>;
};
export type ReactContext<T> = {
    $$typeof: symbol | number;
    // Null on the renderer's internal contexts (HostTransitionContext, CacheContext), which are never rendered as elements.
    Consumer: ReactConsumerType<T> | null;
    Provider: ReactContext<T> | null;
    _currentValue: T;
    _currentValue2: T;
    _threadCount: number;
    // DEV only
    _currentRenderer?: Record<any, any> | null;
    _currentRenderer2?: Record<any, any> | null;
    // This value may be added by application code
    // to improve DEV tooling display names
    displayName?: string;
};
export type ReactPortal = {
    $$typeof: symbol | number;
    key: null | string;
    containerInfo: any;
    children: ReactNodeList;
    // TODO: figure out the API for cross-renderer implementation.
    implementation: any;
};
export type RefObject = {
    current: any;
};
export type ReactScopeQuery = (type: string, props: {
    [key: string]: unknown;
}, instance: unknown) => boolean;
export type ReactScopeInstance = {
    DO_NOT_USE_queryAllNodes(arg1: ReactScopeQuery): null | Array<Record<any, any>>;
    DO_NOT_USE_queryFirstNode(arg1: ReactScopeQuery): null | Record<any, any>;
    containsNode(arg1: Record<any, any>): boolean;
    getChildContextValues: <T>(context: ReactContext<T>) => Array<T>;
};
// The subset of a Thenable required by things thrown by Suspense.
// This doesn't require a value to be passed to either handler.
export interface Wakeable {
    then(onFulfill: () => unknown, onReject: () => unknown): void | Wakeable;
}
// The subset of a Promise that React APIs rely on. This resolves a value.
// This doesn't require a return value neither from the handler nor the
// then function.
// A thenable React tracks. React's Flow type is a union of four states (untracked, pending, fulfilled, rejected),
// but React moves ONE object between them by writing `status`, `value` and `reason` in place, so here it is one type
// whose state fields are optional; code narrows on `status` and reads `value`/`reason` as that state's.
// T is the public type of the settled value; inside React every thenable is one shape (value read as unknown).
export interface Thenable<T> {
    then(onFulfill: (value: unknown) => unknown, onReject: (error: unknown) => unknown): void | Wakeable;
    status?: 'pending' | 'fulfilled' | 'rejected';
    value?: unknown;
    reason?: unknown;
    displayName?: string;
    _debugInfo?: null | ReactDebugInfo;
}
export type PendingThenable<T> = Thenable<T>;
export type FulfilledThenable<T> = Thenable<T>;
export type RejectedThenable<T> = Thenable<T>;
export type StartTransitionOptions = {
    name?: string;
};
export type Usable<T> = Thenable<T> | ReactContext<T>;
// This is an opaque type returned by decodeFormState on the server, but it's
// defined in this shared file because the same type is used by React on
// the client.
export type ReactFormState<S, ReferenceId> = [
    S /* actual state value */,
    string /* key path */,
    ReferenceId /* Server Reference ID */,
    number /* number of bound arguments */
];
// Intrinsic GestureProvider. This type varies by Environment whether a particular
// renderer supports it.
export type GestureProvider = any;
export type GestureOptions = {
    rangeStart?: number;
    rangeEnd?: number;
};
export type Awaited<T> = T; // TS post-pass restores the conditional type
// [name, filename, line, column, enclosing line, enclosing column, isAsync]
export type ReactCallSite = [string, string, number, number, number, number, boolean];
export type ReactStackTrace = Array<ReactCallSite>;
export type ReactComponentInfo = {
    readonly name: string;
    readonly env?: string;
    readonly key?: null | string;
    readonly owner?: null | ReactComponentInfo;
    readonly stack?: null | ReactStackTrace;
    readonly props?: null | {
        [name: string]: unknown;
    };
    // Stashed Data for the Specific Execution Environment. Not part of the transport protocol
    readonly debugStack?: null | Error;
    readonly debugTask?: null | ConsoleTask;
    debugLocation?: null | Error;
};
// The point where the Async Info started which might not be the same place it was awaited.
export type ReactIOInfo = {
    readonly name: string; // the name of the async function being called (e.g. "fetch");
    readonly start: number; // the start time;
    readonly end: number; // the end time (this might be different from the time the await was unblocked);
    readonly byteSize?: number; // the byte size of this resource across the network. (should only be included if affecting the client.);
    readonly value?: null | Promise<unknown>; // the Promise that was awaited if any, may be rejected;
    readonly env?: string; // the environment where this I/O was spawned.;
    readonly owner?: null | ReactComponentInfo;
    readonly stack?: null | ReactStackTrace;
    // Stashed Data for the Specific Execution Environment. Not part of the transport protocol
    readonly debugStack?: null | Error;
    readonly debugTask?: null | ConsoleTask;
};
// Server Components debug info (Flight). Opaque in this client build: production code only passes it along, so the
// entries (ReactDebugInfoEntry in development tooling) are not typed here.
export type ReactDebugInfo = Array<unknown>;
// Intrinsic ViewTransitionInstance. This type varies by Environment whether a particular
// renderer supports it.
export type ViewTransitionInstance = any;
export type ViewTransitionClassPerType = Partial<Record<'default' | string, 'none' | 'auto' | string>>;
export type ViewTransitionClass = 'none' | 'auto' | string | ViewTransitionClassPerType;
export type ViewTransitionProps = {
    name?: string;
    children?: ReactNodeList;
    default?: ViewTransitionClass;
    enter?: ViewTransitionClass;
    exit?: ViewTransitionClass;
    share?: ViewTransitionClass;
    update?: ViewTransitionClass;
    onEnter?: (instance: ViewTransitionInstance, types: Array<string>) => void;
    onExit?: (instance: ViewTransitionInstance, types: Array<string>) => void;
    onShare?: (instance: ViewTransitionInstance, types: Array<string>) => void;
    onUpdate?: (instance: ViewTransitionInstance, types: Array<string>) => void;
};
export type ActivityProps = {
    mode?: 'hidden' | 'visible' | null | undefined;
    children?: ReactNodeList;
    name?: string;
};
export type SuspenseProps = {
    children?: ReactNodeList;
    fallback?: ReactNodeList;
    // TODO: Add "unstable_" prefix?
    suspenseCallback?: (arg1: Set<Wakeable> | null) => unknown;
    unstable_avoidThisFallback?: boolean;
    unstable_expectedLoadTime?: number;
    name?: string;
};
export type SuspenseListRevealOrder = 'forwards' | 'backwards' | 'unstable_legacy-backwards' | 'together' | 'independent' | undefined;
export type SuspenseListTailMode = 'visible' | 'collapsed' | 'hidden' | undefined;
// A SuspenseList row cannot include a nested Array since it's an easy mistake to not realize it
// is treated as a single row. A Fragment can be used to intentionally have multiple children as
// a single row.
type SuspenseListRow = Exclude<ReactNodeList, Iterable<React.ReactNode> | AsyncIterable<React.ReactNode>>;
type DirectionalSuspenseListProps = {
    // Directional SuspenseList are defined by an array of children or multiple slots to JSX
    // It does not allow a single element child.
    children?: Iterable<SuspenseListRow> | AsyncIterable<SuspenseListRow>; // Note: AsyncIterable is experimental.;
    revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards';
    tail?: SuspenseListTailMode;
};
type NonDirectionalSuspenseListProps = {
    children?: ReactNodeList;
    revealOrder?: 'independent' | 'together' | undefined;
    tail?: undefined;
};
export type SuspenseListProps = DirectionalSuspenseListProps | NonDirectionalSuspenseListProps;
export type CacheProps = {
    children?: ReactNodeList;
};
export type ProfilerPhase = 'mount' | 'update' | 'nested-update';
export type ProfilerProps = {
    id?: string;
    onRender?: (id: undefined | string, phase: ProfilerPhase, actualDuration: number, baseDuration: number, startTime: number, commitTime: number) => void;
    onCommit?: (id: undefined | string, phase: ProfilerPhase, effectDuration: number, commitTime: number) => void;
    children?: ReactNodeList;
};
