// Ambient names the Flow -> TypeScript conversion leaves behind: Flow's built-in React and DOM library types,
// mapped onto this port's own types, plus the pre-pass's component placeholder (flow-prepass.py).
import type { ReactContext as PortReactContext, ReactNode as PortReactNode, ReactPortal as PortReactPortal } from './shared/ReactTypes';
import type { ReactElement as PortReactElement } from './shared/ReactElementType';

declare global {
  // V8's stack trace hook (React swaps it while describing component frames).
  interface ErrorConstructor {
    prepareStackTrace?: (error: Error, structuredStackTrace: unknown[]) => unknown;
  }
  // Network Information API (Chromium only).
  interface Navigator {
    readonly connection?: { readonly downlink?: number | null };
  }
  // Element.moveBefore (state-preserving move, Chromium 133+); React DOM keeps it behind supportsMoveBefore.
  interface ParentNode {
    moveBefore(node: Node, child: Node | null): void;
  }
  /** Flow `component(...props: any)`: any component (a host tag, a function component, a class). */
  type ReactComponentPlaceholder = string | ((props: never) => unknown) | (abstract new (props: never) => unknown);
  /** Chrome's async stack tagging (console.createTask). */
  interface ConsoleTask {
    run<T>(f: () => T): T;
  }
  interface Console {
    createTask?: (name: string) => ConsoleTask;
  }
  type EventListenerOptionsOrUseCapture = boolean | AddEventListenerOptions;
  type mixin$Animatable = Animatable;
  namespace mixin {
    type Animatable = globalThis.Animatable;
  }
  namespace React {
    type ReactNode = PortReactNode;
    type ReactElement<P = unknown> = PortReactElement;
    type ReactPortal = PortReactPortal;
    type ElementType = ReactComponentPlaceholder;
    type ComponentProps<C> = C extends (props: infer P) => unknown ? P : C extends abstract new (props: infer P) => unknown ? P : Record<string, unknown>;
    type ElementRef<C> = unknown;
    type RefSetter<I> = ((instance: I | null) => void) | { current: I | null } | null;
    type Key = string | number | bigint;
    type Context<T> = PortReactContext<T>;
  }
}
export {};

// Flow's DOM library gives Element the members React DOM uses on its host instances (always HTML or SVG
// elements, which carry them); TypeScript's Element lacks them.
declare global {
  interface Element {
    readonly style: CSSStyleDeclaration;
    readonly dataset: DOMStringMap;
    blur(): void;
    focus(options?: FocusOptions): void;
    /** HTMLImageElement only: callers test `typeof instance.decode === 'function'` first. */
    decode?: () => Promise<void>;
  }
}
