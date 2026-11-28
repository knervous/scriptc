// The Svelte stream lane's entry: the same exports as the app's (../app/main.svelte.ts), mounting through the DOM stream's
// renderer (./renderer.ts) into adopted page elements, and settling the stream before every page read.
import { flushSync, mount as mountComponent, unmount } from "svelte";
import renderer, { release, setFlushSync, settle, target } from "svelte-stream-renderer";
import App from "../app/App.svelte";
import Label from "../app/Label.svelte";

setFlushSync(flushSync);

/** Mounts the table app into `container`. */
export function mount(container: HTMLElement): void {
  mountComponent(App, { target: target(container), renderer });
  settle();
}

/** One mount/update/unmount cycle of a small tree (3 when every check passed). */
export function cycle(): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const props = $state({ n: 1 });
  let ok = 0;
  const into = target(container);
  const label = mountComponent(Label, { target: into, props, renderer });
  settle();
  if (container.textContent === "count 1") ok++;
  props.n = 2;
  settle();
  if (container.textContent === "count 2") ok++;
  unmount(label);
  settle();
  if (container.textContent === "") ok++;
  release(into);
  container.remove();
  return ok;
}
