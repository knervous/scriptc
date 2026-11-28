# @scriptw/lui

LUI is a small UI library in TypeScript, in the Elm style: a program is a model, a message type, a pure `update`, and a `view` that returns virtual nodes. A keyed patcher brings the DOM in line with each new view. It is written to compile to WasmGC with this repository's compiler, as well as to run as ordinary JavaScript. Its types are closed records, its views are plain function calls, and the DOM is behind one small module.

```ts
// counter.ts
import { h, only, program, type Next } from "@scriptw/lui";

type Model = { count: number };
type Msg = { kind: "inc" } | { kind: "dec" };

const update = (msg: Msg, m: Model): Next<Model, Msg> =>
  only({ count: msg.kind === "inc" ? m.count + 1 : m.count - 1 });

const view = (m: Model, send: (msg: Msg) => void) =>
  h("div", { class: "counter" }, [
    h("button", { onClick: () => send({ kind: "dec" }) }, "-"),
    h("span", null, String(m.count)),
    h("button", { onClick: () => send({ kind: "inc" }) }, "+"),
  ]);

program<Model, Msg>({ init: only({ count: 0 }), update, view }, document.getElementById("app")!);
```

Compile it with [scriptw](https://www.npmjs.com/package/scriptw) and load it in the page with `scriptw/host`:

```console
$ npx scriptw build counter.ts --browser -o public/counter.wasm
```

```js
import { loadWasmGc } from "scriptw/host";

const program = await loadWasmGc("/counter.wasm");
await program.main();
```

The same program also runs as JavaScript through any bundler. JSX (`@scriptw/lui/jsx-runtime`, with `/** @jsxImportSource @scriptw/lui */`) works in the JavaScript build only: the compiler does not lower JSX, so a program compiled with scriptw builds its views with `h`.

## What it has

- **Programs:** `program(spec, root)` mounts one. `send(msg)` runs `update`; the view and patch run once per task, in a microtask, for all the messages sent in it. A handled DOM event flushes before it returns, and `flushSync()` flushes now.
- **Commands:** `withCmds(model, cmds)` runs effects after an update. `afterCommit` is for work that needs the patched DOM, `delay` sends a message later, and `scope.onDispose` ties a timer or listener to the program's life.
- **Subscriptions:** `subscriptions(model)` lists what the program listens to (`every`, `keyDown`, `onPath`, or your own `{ key, start }`), diffed by key after every update.
- **Views:** `h(tag, attrs, children, key)`, or JSX in a JavaScript build. A key (a number or a string) makes a keyed list. `lazy` reuses a subtree while its argument is the same object, `portal` draws into `<body>` or another element, and `contents` lets a program adopt the element it was given.
- **Embedded programs:** `new Embedded(makeSpec)` hosts a program inside an element of another program's view (`host()` gives that element's hooks), or in any element (`attach`).
- **Element hooks:** `ref`, `onMount`, `onPatch`, `onRemove`.
- **Static HTML:** `renderToString(view)`.
- **Routing:** `currentPath`, `navigate`, `onPath`, `linkClick`.

See `docs/guide.md` for how a program runs and how to write views that compile well.

## The DOM module

Every DOM operation the patcher and programs make goes through `#dom` (package.json `imports`):

- `src/dom.ts` is the default: the page's own nodes.
- `src/dom-stream.ts`, chosen with the `dom-stream` condition (`scriptw build counter.ts --browser --conditions dom-stream`), sends the same operations over a batched DOM bridge. The compiled program writes commands into memory and the page replays them once per commit, and structure reads are answered on the compiled side. The page supplies the bridge from `@scriptw/lui/dom-host`:

```js
import { loadWasmGc } from "scriptw/host";
import { createDomHost } from "@scriptw/lui/dom-host";

let memory;
const dom = createDomHost({ memory: () => memory });
const program = await loadWasmGc("/counter.wasm", { modules: dom.imports });
memory = program.instance.exports.memory;
await program.main();
```

## Tests

In the source repository, `npx vitest run packages/lui` bundles `test/scenarios.ts` with the runtime and runs each scenario in a fresh page of headless Chromium.

## License

Apache-2.0 (LICENSE).
