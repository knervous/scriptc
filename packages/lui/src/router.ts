// The page's path for LUI (react-router's BrowserRouter, the parts a page needs): the current path, navigating to
// another (pushed, or replacing the current entry), and a subscription to both and to back/forward.

import type { Sub } from './sub';

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of Array.from(listeners)) listener();
}

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', announce);
}

/** The path now, without the query or the hash. */
export function currentPath(): string {
  return window.location.pathname;
}

/** Goes to `path` within the page (react-router's navigate): pushed onto the history, or replacing the entry. */
export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname + window.location.search && !replace) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  announce();
}

/** Calls `listener` whenever the path may have changed; the result stops it. */
export function subscribePath(listener: () => void): () => void {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A program's subscription to the path: `msg` is sent with the path whenever it may have changed. */
export function onPath<Msg>(msg: (path: string) => Msg): Sub<Msg> {
  return { key: 'router:path', start: (send) => subscribePath(() => send(msg(currentPath()))) };
}

/**
 * A link's click (react-router's Link): a plain left click navigates within the page; a modified or middle click, or
 * a link opening elsewhere, keeps the browser's own behaviour (a new tab, a download).
 */
export function linkClick(path: string): (event: MouseEvent) => void {
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(path);
  };
}
