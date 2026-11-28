# React, in TypeScript

Upstream: facebook/react `v19.2.8` (commit 1dd4ecbdabf826f527fc9a58c05ea70375b7d170), `packages/`. MIT (LICENSE).

Converted from Flow and brought to strict TypeScript by `tools/react-ts` (its README documents the pipeline), then edited by hand to 0 errors; `PATCHES.md` lists the edits made for the WasmGC builds since. The pipeline also folds the production browser client's flags and resolves its module forks.

These packages are present, reduced to what the client entry points reach:
- `react`
- `react-dom`
- `react-dom-bindings`
- `react-reconciler`
- `scheduler`
- `shared`

Everything else in upstream's `packages/` is left out: the server renderers, Flight, DevTools, the test renderers and the other hosts.

Behavioural differences from the JavaScript build: none for client rendering apart from these:
- **Fizz stylesheets:** stylesheets server-rendered by Fizz carry a `_p` loading promise that this build does not recognise. The WasmGC builds here never hydrate server HTML.
- **Enumerability:** the methods of the classes converted from function constructors (FiberNode, FiberRootNode, ReactDOMRoot, Component, PureComponent) are non-enumerable, and `createElement.length` / `cloneElement.length` differ (rest parameters).
- **Synthetic events:** one `SyntheticBaseEvent` class carries the methods (`preventDefault`, `stopPropagation`, `persist`, `isPersistent`) as its own non-enumerable prototype methods, and each event Interface is a declared subclass of it (upstream builds unrelated classes from a factory and assigns enumerable methods onto each prototype). So `instanceof` holds across event classes where upstream's does not.
- **`getModifierState`:** each event gets a closure over its native event; upstream shares one `this`-reading getter, so a detached call works here where upstream's throws.
- **Value tracking:** the `value`/`checked` accessors React installs on an input close over the node rather than reading `this` (they are installed on that node, so this differs only if they are called on another receiver).
- **Class component `setState` with a partial object:** not supported yet. The merge would build a plain object a compiled class cannot read back as its typed state, so it throws a TypeError ("adding a property to a typed record"). The root's own state merge (`{element}` payloads) is typed and exact. Function components are unaffected.
- **Component stacks:** frames are name-based (`    in Name`); the compiled build cannot read engine stack traces.
- **`assign` (Object.assign):** a source with an enumerable symbol key throws a TypeError instead of copying it.

