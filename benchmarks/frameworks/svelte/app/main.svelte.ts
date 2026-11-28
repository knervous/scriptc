// The Svelte 5 build's entry: the same exports as the React and Solid programs, mount(container) and cycle().
import { flushSync, mount as mountComponent, unmount } from "svelte";
import App from "./App.svelte";
import Label from "./Label.svelte";

/** Mounts the table app into `container`. */
export function mount(container: HTMLElement): void {
  mountComponent(App, { target: container });
  flushSync();
}

/** One mount/update/unmount cycle of a small tree (3 when every check passed). */
export function cycle(): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const props = $state({ n: 1 });
  let ok = 0;
  const label = mountComponent(Label, { target: container, props });
  flushSync();
  if (container.textContent === "count 1") ok++;
  props.n = 2;
  flushSync();
  if (container.textContent === "count 2") ok++;
  unmount(label);
  if (container.textContent === "") ok++;
  container.remove();
  return ok;
}
