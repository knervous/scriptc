# Results

The same table program on four UI frameworks: React 19.2.8 (published, from npm), SolidJS 1.9.20, Svelte 5.59.2 and LUI (`packages/lui`). Each runs as JavaScript and compiled to WasmGC with this repository's compiler, in headless Chromium, on the React benchmark's page and method (`../react-dom/README.md`). Every lane of every framework renders the same table: the cross-lane fingerprint matched in every run here, and no sample failed its check.

Figures are medians from `receipts/final.json`, with LUI's three lanes from `receipts/final-lui.json` (re-run in the same session after the change listed under "Tried and dropped") and React's from `receipts/react-published.json` (published React, and its TypeScript port's stream lane in the same run): 3 fresh pages per operation and lane, each with 5 untimed and 10 timed samples (create10k a third of that). A JavaScript lane shows its median script time. A WasmGC lane shows its ratio to its own framework's JavaScript lane, so lower is better and 1.00 is parity. Run-to-run spread is about ±10% on the 1–25 ms operations, and more on the sub-millisecond ones (select, swap, remove, update10th) and on cycle.

Machine: a 4-core Intel Xeon at 2.30 GHz with 15 GB of memory, Linux, Chromium 158.0.8127.36 (Playwright's headless build), Node 22.

## Script time

A JavaScript lane's median, and each WasmGC lane's ratio to its framework's JavaScript lane (`tables.mjs final,final-lui,react-published`, without `final`'s React stream column, which `react-published` measures again as "react port stream").

<table>
<thead><tr><th>Operation</th><th>react js</th><th>react published</th><th>react port stream</th><th>solid js</th><th>solid published</th><th>solid port</th><th>solid stream</th><th>svelte js</th><th>svelte published</th><th>svelte stream</th><th>lui js</th><th>lui port</th><th>lui stream</th></tr></thead>
<tbody>
<tr><td>create1k</td><td>8.94 ms</td><td>3.29</td><td>2.27</td><td>3.62 ms</td><td>1.72</td><td>1.67</td><td>1.79</td><td>4.85 ms</td><td>2.48</td><td>3.54</td><td>7.62 ms</td><td>1.54</td><td>1.66</td></tr>
<tr><td>replace1k</td><td>15.5 ms</td><td>2.23</td><td>1.43</td><td>7.60 ms</td><td>1.40</td><td>1.50</td><td>1.58</td><td>8.44 ms</td><td>2.55</td><td>2.97</td><td>12.9 ms</td><td>1.28</td><td>1.53</td></tr>
<tr><td>update10th</td><td>1.50 ms</td><td>4.98</td><td>2.10</td><td>0.388 ms</td><td>1.99</td><td>1.03</td><td>1.28</td><td>0.550 ms</td><td>2.46</td><td>3.16</td><td>1.07 ms</td><td>1.19</td><td>1.13</td></tr>
<tr><td>select</td><td>0.623 ms</td><td>7.71</td><td>3.14</td><td>0.132 ms</td><td>4.25</td><td>1.02</td><td>0.96</td><td>0.608 ms</td><td>8.60</td><td>11.95</td><td>0.370 ms</td><td>1.20</td><td>1.19</td></tr>
<tr><td>swap</td><td>8.27 ms</td><td>1.48</td><td>1.11</td><td>0.377 ms</td><td>2.09</td><td>3.96</td><td>0.97</td><td>0.440 ms</td><td>3.05</td><td>3.06</td><td>4.93 ms</td><td>1.04</td><td>1.04</td></tr>
<tr><td>remove</td><td>0.895 ms</td><td>5.37</td><td>2.94</td><td>0.332 ms</td><td>2.17</td><td>4.59</td><td>1.02</td><td>0.470 ms</td><td>2.66</td><td>2.27</td><td>0.383 ms</td><td>1.26</td><td>1.28</td></tr>
<tr><td>create10k</td><td>165.4 ms</td><td>2.23</td><td>2.62</td><td>36.5 ms</td><td>2.02</td><td>2.01</td><td>2.61</td><td>60.0 ms</td><td>2.35</td><td>3.51</td><td>79.6 ms</td><td>2.06</td><td>1.95</td></tr>
<tr><td>append1k</td><td>8.85 ms</td><td>3.75</td><td>2.07</td><td>3.58 ms</td><td>1.79</td><td>1.95</td><td>1.91</td><td>4.09 ms</td><td>2.94</td><td>4.04</td><td>6.98 ms</td><td>1.59</td><td>1.59</td></tr>
<tr><td>clear</td><td>6.51 ms</td><td>1.07</td><td>1.00</td><td>2.76 ms</td><td>1.16</td><td>0.97</td><td>1.06</td><td>3.10 ms</td><td>1.78</td><td>2.61</td><td>3.14 ms</td><td>1.08</td><td>1.75</td></tr>
<tr><td>cycle</td><td>0.082 ms</td><td>1.66</td><td>4.31</td><td>0.005 ms</td><td>3.60</td><td>1.60</td><td>3.70</td><td>0.034 ms</td><td>11.24</td><td>10.66</td><td>0.010 ms</td><td>2.70</td><td>3.15</td></tr>
</tbody>
</table>

In milliseconds, the fastest WasmGC lane on create1k is Solid's typed port (6.0 ms), against published React at 29.4 ms (its TypeScript port on the stream: 20.3 ms). The fastest JavaScript lane is Solid's (3.6 ms).

## The lanes

- **react published:** the app built against published React (react and react-dom 19.2.8 from npm, unmodified) as a user would build it: `scriptw build --browser --release`'s options (`../react-dom/build-wasm.mjs --published`). React stays npm JavaScript: the page loads it and hands it to the loader (`modules`), so React and React DOM run as the page's JavaScript, and the compiled app's components call into them across the boundary. This is the out-of-the-box lane, and React's headline here.
- **js:** the framework's own JavaScript build: esbuild, minified, production conditions. Solid's JSX goes through babel-preset-solid, Svelte's components through the Svelte compiler, and React and LUI are plain TypeScript.
- **published** (Solid, Svelte): the JavaScript lane's own bundle, unminified, compiled to WasmGC as it is (`browser: true`, native dyn, native any). Every value in it is untyped, and its DOM calls are per-call host calls.
- **port** (Solid, LUI): typed TypeScript, compiled, with per-call DOM.
  - Solid's is a typed port of the part of its runtime this program reaches (`solid/port`, `solid/PATCHES.md`).
  - LUI is TypeScript already, so its port lane is the package compiled as it is.
- **stream** (all four): the framework's DOM on the DOM stream (`packages/dom-stream`). DOM changes are written as commands into module memory and replayed by the page once per flush, structure is read from a compiled-side mirror, and events cross once each.
  - React (secondary, "react port stream"): its TypeScript port (`packages/react-ts`, repository only) with its DOM host config on the stream (`packages/react-ts/PATCHES.md`). It shows what typing React's internals buys: 1.3–2.5 times faster than published React on create1k, replace1k, update10th, select, swap, remove and append1k, even on clear, and slower on create10k (2.62 against 2.23).
  - Solid: the port with `solid/port/dom-stream.ts`.
  - Svelte: its published runtime, with the components compiled for a custom renderer over the stream (`svelte/stream/renderer.ts`).
  - LUI: its `#dom` module set to `dom-stream.ts`.

React's per-call lane is not re-run here. Its port now builds only for the stream, and the per-call figures in `../react-dom/RESULTS.md` (create1k 5.38, for example) come from an earlier session on the same machine type.

## Host calls per operation

Host imports called per operation, from one counted page per lane (`receipts/final-counts.json`, `run.mjs --count`). LUI's port column is from the build before its globals were read once; that build makes 90,011 calls per create1k, not 116,011.

<table>
<thead><tr><th>Operation</th><th>solid.published</th><th>solid.port</th><th>svelte.published</th><th>lui.port</th><th>react.stream</th><th>solid.stream</th><th>svelte.stream</th><th>lui.stream</th></tr></thead>
<tbody>
<tr><td>create1k</td><td>19,130</td><td>32,069</td><td>76,152</td><td>116,011</td><td>15,171</td><td>1,004</td><td>57,025</td><td>1,014</td></tr>
<tr><td>replace1k</td><td>27,132</td><td>52,078</td><td>78,152</td><td>117,011</td><td>15,186</td><td>1,006</td><td>59,027</td><td>1,016</td></tr>
<tr><td>update10th</td><td>422</td><td>361</td><td>2,448</td><td>210</td><td>2,977</td><td>4</td><td>3,219</td><td>110</td></tr>
<tr><td>select</td><td>1,119</td><td>57</td><td>18,142</td><td>16</td><td>2,187</td><td>4</td><td>28,020</td><td>11</td></tr>
<tr><td>swap</td><td>3,137</td><td>11,088</td><td>160</td><td>2,007</td><td>2,178</td><td>4</td><td>27</td><td>10</td></tr>
<tr><td>remove</td><td>3,121</td><td>11,033</td><td>145</td><td>12</td><td>2,184</td><td>4</td><td>29</td><td>10</td></tr>
<tr><td>create10k</td><td>199,106</td><td>329,045</td><td>760,152</td><td>1,160,011</td><td>150,215</td><td>10,016</td><td>570,035</td><td>10,060</td></tr>
<tr><td>append1k</td><td>24,084</td><td>44,054</td><td>76,152</td><td>116,011</td><td>17,179</td><td>1,004</td><td>57,025</td><td>1,014</td></tr>
<tr><td>clear</td><td>131</td><td>68</td><td>156</td><td>1,010</td><td>183</td><td>4</td><td>2,025</td><td>10</td></tr>
<tr><td>cycle</td><td>150</td><td>160</td><td>895</td><td>242</td><td>371</td><td>175</td><td>855</td><td>167</td></tr>
</tbody>
</table>

- **The stream lanes cross the boundary almost only to flush.** Solid's and LUI's remaining thousand per create1k are `num.toString`: a row id becomes text through the page. Formatting integers in compiled code would remove them.
- **React's** stream lane (the port) makes 13,000 `js.eq` comparisons of page symbols (`$$typeof`), as in `../react-dom/RESULTS.md`.
- **Published React** (`receipts/react-published-counts.json`) makes 90,307 host calls per create1k, about 90 per row, and 20,000–27,000 per row operation: every element the compiled components create is a call into the page's React with its arguments converted. Most are `createElement`'s variadic children built as page arrays (`js.arrLit.0` and `js.push`, 31,000 per create1k), prototype reads of facades (`js.protoOf`, 17,000) and props objects handed over as facades (`js.dynFacade`, `js.recordFacade`, 13,000).
- **Svelte's** are its untyped runtime: symbol tests, facade reads and property keys, the same in both lanes.

## Where the time goes

create1k, split by CPU profile (`../react-dom/profile.mjs`, 8 samples each): compiled code; the boundary (the host's JavaScript, and on the stream the page's replay); the DOM natives that JavaScript calls; the page's own script (all of a JavaScript lane); and the garbage collector. Sampling adds overhead, so these are shares, not timings.

<table>
<thead><tr><th>Lane</th><th>Script</th><th>Compiled</th><th>Boundary</th><th>DOM natives</th><th>Page</th><th>GC</th></tr></thead>
<tbody>
<tr><td>react js</td><td>9.4 ms</td><td></td><td></td><td></td><td>84%</td><td>16%</td></tr>
<tr><td>react published</td><td>38.8 ms</td><td>15%</td><td>25%</td><td>1%</td><td>55%</td><td>3%</td></tr>
<tr><td>react port stream</td><td>21.2 ms</td><td>67%</td><td>14%</td><td>16%</td><td>2%</td><td>1%</td></tr>
<tr><td>solid js</td><td>4.3 ms</td><td></td><td></td><td></td><td>99%</td><td>1%</td></tr>
<tr><td>solid published</td><td>8.2 ms</td><td>39%</td><td>26%</td><td>25%</td><td>3%</td><td>6%</td></tr>
<tr><td>solid port</td><td>7.3 ms</td><td>40%</td><td>27%</td><td>25%</td><td>4%</td><td>4%</td></tr>
<tr><td>solid stream</td><td>10.0 ms</td><td>27%</td><td>20%</td><td>25%</td><td>3%</td><td>24%</td></tr>
<tr><td>svelte js</td><td>5.2 ms</td><td></td><td></td><td></td><td>91%</td><td>9%</td></tr>
<tr><td>svelte published</td><td>15.0 ms</td><td>56%</td><td>18%</td><td>18%</td><td>2%</td><td>6%</td></tr>
<tr><td>svelte stream</td><td>20.2 ms</td><td>62%</td><td>25%</td><td>10%</td><td>1%</td><td>2%</td></tr>
<tr><td>lui js</td><td>9.5 ms</td><td></td><td></td><td></td><td>96%</td><td>4%</td></tr>
<tr><td>lui port</td><td>14.2 ms</td><td>38%</td><td>23%</td><td>28%</td><td>2%</td><td>8%</td></tr>
<tr><td>lui stream</td><td>15.1 ms</td><td>46%</td><td>23%</td><td>25%</td><td>2%</td><td>3%</td></tr>
</tbody>
</table>

- **The DOM work itself** is a floor every lane shares: about 2–4 ms of create1k, the same DOM natives a JavaScript lane calls. On the stream lanes it is replayed by the page.
- **Solid:**
  - Its per-call lanes spend a quarter of their time in host JavaScript: one host call per DOM read or write (19,130 or more per create1k).
  - The stream moves that cost into the page's replay, about 2 ms, and keeps structure reads in compiled code.
  - What it adds is garbage: a quarter of the stream lane's profile is GC. That is the mirror nodes, ten per row, and the clone and text command buffers. Compiled Solid itself is the smallest compiled share of any framework.
- **Svelte** is compiled code first in both lanes. Its untyped runtime spends the time in dynamic dispatch, and on the stream the renderer adds a typed call per DOM operation on top of it.
- **LUI**'s compiled share is its virtual-DOM diff, which its JavaScript lane also runs (and which takes most of that lane's 9.5 ms). On the stream, the replay replaces the per-call boundary, so the two lanes are close.
- **Published React** spends 55% in the page's script: React itself, whose `createElement` reads each compiled props object through a facade (22% alone), and the DOM it builds. The boundary takes another 25%, and the compiled components 15%.
- **React's port**'s compiled share (two thirds) is its reconciler and fibers, as `../react-dom/RESULTS.md` found.

## The bridge

Both template frameworks build DOM by cloning templates and walking `firstChild` and `nextSibling`. The DOM stream gained what they need, generically: nothing in it names a framework. One schema (`packages/dom-stream/dom.schema.json`) generates both sides.

- **Templates.** `host:dom template(id, html)` parses a template's HTML once, on the page, and answers its shape: each node's type, child count, names and text, in document order. One `cloneTemplate(id, handles)` command clones it and gives every node of the clone its handle. The compiled side makes the clone's nodes from the shape, already linked, so walking the clone reads fields and makes no call. A template with several top-level nodes clones as a fragment, and inserting a fragment moves its children on both sides.
- **The generator** gained a `handles` argument: a count and that many handles, last only.
- **Delegated events.** `delegate(root, type)` puts one page listener on `root`. Each event reaches the compiled side once, with the nearest node of the table at or above its target, and per-node handlers live in a slot of the compiled node (`setHandler`, `bubble`). Solid delegates at the document as it does in JavaScript. Svelte's custom-renderer path would put a listener on every element, so its renderer delegates instead.
- **`createFragment`**, for custom renderers.
- **Release** drops a node's renderer state with its handle.

The owner's boundary style holds throughout:

- Per-item traffic crosses in batches: one flush per update.
- Hot reads (structure, text the compiled side wrote) are answered in place.
- Only numbers, strings and handles cross, plus the event itself, once.

What each framework is told about flushing:

- **Solid** writes the DOM synchronously, inside an update or an event handler. The stream flushes at the end of the outermost update, unless a delegated event is being dispatched, and at the end of each delegated dispatch.
- **Svelte** writes the DOM when it flushes its batch, in a microtask after a change. Each delegated event queues one microtask that runs Svelte's `flushSync` and then flushes the stream, and the entry does the same after its own changes.
- **LUI** changes the DOM only inside a commit. The stream flushes when the outermost commit ends, before `onMount` hooks and after-commit steps run, and again after them if they ran.
- **React** flushes in `resetAfterCommit`, as `../react-dom/RESULTS.md` describes.

In every case no page code can run between a DOM change and its flush, so the page is exact whenever it can be observed.

Releasing nodes follows what each framework does with a removed node:

- Solid's DOM code and LUI never insert a removed node again, so it is released when it is removed.
- Svelte inserts some removed nodes again at once (an each block's anchor after a clear), so a removed node is released at the next flush point if it is still detached then.

## Compile input

- **Solid.** The published ESM compiles as it is, and at 1.7–2.0 on the creation operations it is already close to the typed port. The typed port is still warranted. Its select, update10th and clear run at JavaScript's speed per call, where the untyped runtime pays dynamic dispatch on every signal and computation. It is also what the stream lane needs, because the DOM layer has to work on typed nodes. The port is about 1,000 lines: the tree-shaken runtime, with typed `Owner`, `Computation` and `Signal` classes. Its per-call swap and remove lose to the published runtime, because `insert` takes untyped values and its tests on page nodes are host calls. That cost is gone on the stream.
- **Svelte.** The published runtime compiles and runs. It needed one compiler fix to render (the no-op default below) and one to lose its teardown pathology (`index_of.call`). A typed port of its hot core would be far larger than Solid's: its reactivity, batching and keyed-each modules are about 6,350 lines, with async and fork machinery threaded through them. Compiling its JSDoc-typed source unbundled was tried instead (below) and set aside. So Svelte runs untyped in both WasmGC lanes, and that is most of its gap.
- **LUI** needs no port: it was written for this compiler, with closed records, one element type and views as function calls. Its DOM had to move behind one module so that the stream could replace it.
- **React** is published React, unmodified. Built with the package's defaults, it stays npm JavaScript on the page (above). Compiling it into the module (`--compile-packages react,react-dom,scheduler`, the compiler's npm-static mode) does not work yet, for two reasons. React's entry picks its build at run time (`if (process.env.NODE_ENV === "production") module.exports = require("./cjs/react.production.js")`), and the compiler follows CommonJS exports only at a module's top level, so the app's named imports (`memo`, `createRoot`, `flushSync`, ...) have no binding to lower (SC1090). And with `@types/react` installed, the checker types those imports from the declarations while the compiler would compile the JavaScript; without them the program does not type-check against React's inferred surface and the packages fall back to the page. The same entry shape stops published `react-reconciler` (a DOM-stream lane through a custom host config), so that lane was not built. The TypeScript port remains the repository's typed React.

Compiler bugs found and fixed on the way, each in its own commit with a browser fixture that matches Node in the engine, native, native-any and production lanes, dev and release:

- `Array.prototype.pop` on a typed array from untyped code was refused (Solid's `cleanNode`).
- A callback passed for a JavaScript parameter defaulted to a no-op (`title = noop`) adopted the inferred `() => void` and dropped its value. Svelte's snippets rendered empty text.
- An `if` condition's short-circuited operand fenced the whole statement: `if (DEV && ... && adjustments.has(error))` threw although DEV is false.
- An optional generic parameter instantiated as `unknown` was refused (Svelte's `pop()`).
- A JSDoc cast to a type parameter instantiated as `void` was refused (`flushSync()`).
- A captured `Array.prototype` method called with `.call` went to the page's function over a facade of the compiled array (`index_of.call(list, x)`). It now runs natively on a compiled array: Svelte's clear fell from 6,157 host calls to 156, and from 13.4 to 1.9 times JavaScript.

## Tried and dropped

- **Svelte from its JSDoc-typed source** (`build-wasm.mjs svelte jsdoc`). Compiling Svelte's published `src/` unbundled, with `checkJs`, gives the compiler its JSDoc types. It took four compiler fixes (listed above) and two staging patches (`svelte/PATCHES.md`) to build and mount. It left 32 deferred fences, among them `proxy.js`'s generic arrow inside a function (the `$state` proxy). The cycle step still fails, and create1k never finishes. Set aside; the published bundle runs untyped instead.
- **Solid's typed port with per-call DOM.** Against the published runtime in the same receipt, the port wins where reactivity dominates: select 1.02 against 4.25, update10th 1.03 against 1.99, clear 0.97 against 1.16. It loses where `insert` reconciles node arrays: swap 3.96 against 2.09, remove 4.59 against 2.17. Its values there are untyped, so every test on a page node is a host call (11,088 host calls per swap against 3,137). Both lanes are kept: the port's real use is the stream, where swap is 0.97 and remove 1.02.
- **Solid's delegated handlers in a page `WeakMap`** rather than on the node. Four host calls per handler against one: create1k fell from 46,087 to 32,069 host calls with handlers on the node as `$$click`, as Solid keeps them.
- **Releasing a node when Svelte removes it.** Its each block removes its anchor on a clear and inserts it again at once, so the released handle was gone ("no node 47"). A removed node is released at the next flush point if it is still detached.
- **Letting the page make Solid's text nodes** (`textContent = text`). The compiled side never saw them, so update10th's in-place write found no child. The stream module makes the text node itself.
- **Svelte's custom renderer as published.** Without the template patch, `from_tree` builds every node of every clone through the renderer, one command or more per node. Without delegation, every row gets its own listeners. Both are replaced (`svelte/PATCHES.md`); the stream lane is still 2.3–12× JavaScript, because the runtime that drives the renderer is untyped and every renderer call crosses from untyped into typed code.
- **LUI's page DOM reading its globals each time.** Reading `document`, `SVGElement` and `HTMLElement` once instead took LUI's per-call create1k from 116,011 to 90,011 host calls. In the same session: create1k 1.71 → 1.49, append1k 1.84 → 1.55, create10k 2.17 → 1.81. Kept.

## Which framework fits WasmGC best

**Solid**, for this compiler as it stands. Its runtime is small enough to port (about 1,000 lines), its work is fine-grained (an update touches the nodes it changes and nothing else), and its compiler writes the DOM as templates plus a few writes, which is exactly what the stream batches. On the stream it is within 6% of JavaScript on select (0.96), swap (0.97), remove (1.02) and clear (1.06), its update10th is 1.28, and creation is 1.6–1.9 (2.6 for create10k). It makes about 1,000 host calls per create1k, nearly all `num.toString` for the row ids, against React's 15,171 and Svelte's 57,025. What separates it from parity on creation is compiled code: the per-row closures, computations and mirror nodes the compiler allocates and runs more slowly than V8's JIT does in JavaScript.

**LUI** is the closest second, and the cheapest to keep: it is TypeScript already, and nothing had to be ported or patched beyond moving its DOM behind one module. On the stream its creation ratios are among the best of the four (create1k 1.66, append1k 1.59, create10k 1.95), and every row operation but clear (1.75) is within 1.3. Its JavaScript lane is a virtual-DOM diff, though, about twice Solid's time in JavaScript, so in absolute terms Solid on WasmGC is faster than LUI on WasmGC.

**React**, as published, runs out of the box: React and React DOM run as the page's JavaScript and only the app's components are compiled. That costs 1.1–7.7 times React's own JavaScript (create1k 3.29, replace1k 2.23, clear 1.07, select 7.71), almost all of it the boundary: about 90 host calls per row, and React's `createElement` reading compiled props through facades (a quarter of create1k's profile). Its TypeScript port on the stream, which compiles React's reconciler too, is 1.0–3.1 (4.3 on cycle) and shows what typing React's internals buys. Either way its virtual DOM makes it the slowest of the four in milliseconds.

**Svelte 5** compiles from its published runtime, but stays untyped: its runtime is too large to port in a session, and its JSDoc-typed source does not compile yet. Untyped, every signal read, effect and DOM write is dynamic dispatch, and on the stream every renderer call crosses into typed code. It is the worst fit here (1.8–12 times JavaScript). The likely fix is compiler work on its JSDoc-typed source, which would type the runtime without a port.
