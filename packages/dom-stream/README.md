# dom-stream

A DOM bridge for renderers compiled to WasmGC. On the compiled side (`src/dom.ts`) the renderer's nodes are compiled objects. Every change to them is written as a command into the DOM stream, a host stream (`../host-stream`) whose contract is `dom.schema.json`. The page (`src/dom-host.js`) replays the commands in one loop when the renderer flushes, once per commit for React DOM.

- **Nodes** are handles into the page's node table. A node also keeps its place in the tree (parent, first and last child, siblings), so reads of structure are answered on the compiled side, with no call. That holds while the page leaves the renderer's nodes to the renderer, as React DOM requires.
- **Names** (tags, attributes, style properties) are atoms, defined in the stream the first time they are used. **Strings** are offsets into one string per flush.
- **Focus and selection:** a commit is bracketed by `beginCommit` and `endCommit`. The page has not yet replayed the commit's mutations when it reaches `beginCommit`, so it notes the focused element and its selection there, and restores them at `endCommit`. This is what React DOM's `prepareForCommit` and `resetAfterCommit` do, with nothing read back across the seam.
- **The way back:** `page(node)` flushes the stream and answers the page's own node (one call the first time). A renderer uses it for refs and for paths the bridge does not cover. `adoptNode(pageNode)` enters a page node made elsewhere, such as a root container. `nodeAbove(pageNode)` answers the bridge node at or above an event's target.

The calls that answer at once are the `host:dom` module (`src/dom-imports.d.ts`): adopt, node, describe and handleAbove.

## Files

- `dom.schema.json`: the stream's commands and records.
- `src/dom-stream.generated.ts`, `src/dom-stream.generated.js`: both sides' code, generated from the schema. Do not edit them; regenerate with `node packages/host-stream/src/gen.mjs packages/dom-stream/dom.schema.json --ts packages/dom-stream/src/dom-stream.generated.ts --js packages/dom-stream/src/dom-stream.generated.js`. The host-stream tests fail when they are stale.
- `src/dom.ts`: the compiled side's nodes, documents, styles and the node table.
- `src/dom-host.js`: the page's node table, the replay handlers, and React DOM's clear-container and selection logic on the page.

## Using it

```js
import { instantiateLinked } from "<compiler>/backend/wasmgc/host.js";
import { createDomHost } from "dom-stream/src/dom-host.js";

let memory;
const dom = createDomHost({ memory: () => memory });
const linked = await instantiateLinked(bytes, { "": {} }, dom.imports);
memory = linked.instance.exports.memory;
await linked.modules[""].main();
```
