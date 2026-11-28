// The page's half of the DOM bridge that is not the stream (src/dom-host.js): the calls that must answer at once.
declare module "host:dom" {
  /** Enters a page node in the node table under `handle`, or answers the handle it already has there. */
  export function adopt(node: Node, handle: number): number;
  /** The page node a handle names (the stream is flushed first by the caller). */
  export function node(handle: number): Node;
  /** The nearest table node at or above a page node: its handle when it is the node itself, minus its handle when it is an
   * ancestor, 0 for none. */
  export function handleAbove(node: Node): number;
  /** Where the page sends events: `dispatch(node, listener, event)` for a node's listener the stream registered (listen). */
  export function events(dispatch: (node: number, listener: number, event: Event) => void): void;
  /** What the page knows of an adopted node: its nodeType, its nodeName, its namespaceURI ("" for none). */
  export function describe(node: Node, what: number): string;
  /** Parses `html` once, as template `id` (a template element's content), and answers its shape: for each node in document
   * order, the clone's root first (a fragment for several top-level nodes), its nodeType, child count, nodeName, localName,
   * namespaceURI and text, each field followed by U+0001 (dom.ts readShape). */
  export function template(id: number, html: string): string;
  /** Where the page sends delegated events (the stream's delegate): `dispatch(delegation, target, event)`, with the compiled
   * side's index for the listener and the handle of the nearest table node at or above the event's target (0 for none). */
  export function delegated(dispatch: (delegation: number, target: number, event: Event) => void): void;
}
