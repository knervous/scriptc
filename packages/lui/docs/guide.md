# A short guide to LUI

## How a program runs

1. `program(spec, root)` takes the initial model (`spec.init`), draws `spec.view(model, send)` once, and appends it to `root`. It then starts the subscriptions and runs the initial commands.
2. `send(msg)` calls `spec.update(msg, model)`. When the returned model is a different object, the program is marked dirty. Messages sent while one is being handled wait their turn, in order.
3. A dirty program draws its view and patches the DOM once, in a microtask, however many messages arrived in the task. A DOM event handled by LUI flushes every dirty program before the handler's event returns, so the DOM is current when the browser next looks at it.
4. After each update, the subscriptions are diffed by key: new keys start, missing keys stop, and kept keys keep running with their original closure. A parameter the subscription depends on belongs in its key.
5. `dispose()` stops subscriptions and command scopes and removes the program's DOM. Elements with `onRemove` hear about it.

Updates are pure. Effects are commands: `(send, scope) => void`, run after the update and before the patch. `afterCommit(cmd)` waits for the patch, for focus or measuring.

## Views

A view returns one element. Children are a node, a string or number (text), `null`, `undefined` or a boolean (a placeholder that keeps sibling positions), or a list of these.

- **Keys.** Give each element in a list a key (`h("li", attrs, children, row.id)`, or `key={row.id}` in JSX). The patcher patches the unchanged ends of a keyed list in place, and matches the middle by key: an element keeps its identity while its key and tag do. A numeric key is the cheap case.
- **Handlers.** Each element has one listener per event type, and it reads the element's current vnode. A new closure every render costs nothing.
- **`lazy(key, arg, view, memory)`** skips rebuilding a subtree while `arg` is the same object as last time. `memory.swap()` after each view keeps the memory current.
- **Form fields** are controlled: after an event, a field is put back to its vnode's `value` or `checked` if the event moved it.

## Writing for a WasmGC build

LUI is written so that a WasmGC compiler can type it. Programs that follow the same habits compile well:

- Keep models and messages as closed records and unions of records. Name the message type where TypeScript would otherwise infer one arm (`delay<Msg>(…)`).
- Write views as function calls (`{rowView(row)}`), not components. JSX writes intrinsic elements only, so every literal is one `Attrs` record.
- Keep handler closures small. They are stored on vnodes and called through the element's listener.

## The DOM stream

A WasmGC build can set the `dom-stream` import condition to use `src/dom-stream.ts`.

- **Writes** become commands in the stream. The page replays them at the end of each outermost commit, before `onMount` hooks and after-commit steps run.
- **Reads** of structure (`firstChild`, `nextSibling`, `parentNode`) are answered from the compiled side's copy of the tree.
- **Form state** (`value`, `checked`) is read from the page when it is needed.
- **Removed nodes** leave the bridge's node tables at once, since LUI never inserts a removed node again.
