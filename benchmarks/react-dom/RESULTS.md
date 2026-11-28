# Results

React 19 compiled to WasmGC, against JavaScript React 19.2.8 on the same app, in headless Chromium. Each figure is the median script time of the WasmGC lane divided by the JavaScript lane's, from the receipts in `receipts/` (3 pages per operation, 5 warmup and 10 timed samples each, create10k a third of that). Lower is better; 1.00 is parity.

## Progress

<table>
<thead><tr><th>Operation</th><th>Per-call DOM</th><th>DOM stream, step 1</th><th>Step 2</th><th>Step 3</th><th>Step 4 (now)</th></tr></thead>
<tbody>
<tr><td>create1k</td><td>5.38</td><td>3.95</td><td>3.01</td><td>2.74</td><td>2.31</td></tr>
<tr><td>replace1k</td><td>4.02</td><td>2.64</td><td>1.79</td><td>1.60</td><td>1.52</td></tr>
<tr><td>update10th</td><td>4.57</td><td>4.43</td><td>2.58</td><td>2.33</td><td>2.05</td></tr>
<tr><td>select</td><td>4.83</td><td>4.91</td><td>2.82</td><td>3.06</td><td>2.79</td></tr>
<tr><td>swap</td><td>1.58</td><td>1.55</td><td>1.29</td><td>1.24</td><td>1.04</td></tr>
<tr><td>remove</td><td>4.78</td><td>4.85</td><td>2.90</td><td>2.89</td><td>3.23</td></tr>
<tr><td>create10k</td><td>5.87</td><td>5.04</td><td>2.81</td><td>2.89</td><td>3.03</td></tr>
<tr><td>append1k</td><td>5.64</td><td>3.57</td><td>2.64</td><td>2.68</td><td>2.20</td></tr>
<tr><td>clear</td><td>1.63</td><td>0.96</td><td>1.14</td><td>1.23</td><td>1.25</td></tr>
<tr><td>cycle</td><td>4.61</td><td>5.51</td><td>3.80</td><td>3.40</td><td>5.97</td></tr>
</tbody>
</table>

Run-to-run spread is about ±10% on the 1–25 ms operations. The sub-millisecond ones (select, remove, cycle) move more: cycle has measured between 3.4 and 6.0 across runs of the same build. Same-session A/B runs between two builds, not columns from different days, decided each step.

Receipts: `baseline-percall-identityfix.json`, `bridge-step1.json`, `bridge-step2.json`, `bridge-step3.json`, `bridge-step4.json`.

## What each step was

- **Per-call DOM.** Every DOM operation is its own host import call: about 245,000 calls for create1k.
- **Step 1: the DOM stream** (`packages/host-stream`, `packages/dom-stream`). DOM mutations are written as commands into an arena in module memory and replayed by the page once per flush. Reads are answered from a mirror kept on the compiled side, and events arrive in one call each. create1k falls to about 68,000 host calls.
- **Step 2: compiler and port fixes found by profiling.**
  - Computed-key reads on plain objects skip the class-dispatch chain.
  - A read-only `Object.keys` local shares one typed key array per shape.
  - A typed symbol enters dynamic code without a host call.
  - The port's `Fiber` lost a second, record representation that untyped casts had given it.
  - `createElement` stopped reading `defaultProps` from string types.
  - create1k falls to about 15,000 host calls, mostly page-symbol comparisons.
- **Step 3: the bridge stopped leaking.**
  - Deleted nodes are released from both node tables, which had kept every node and detached page node alive.
  - Listeners live on their node, so old containers can be collected.
  - A record key many shapes declare is read through one indirect call by type index.
- **Step 4: React elements are one typed record.** The port's element type had `any` fields, so elements lowered as untyped objects and every `element.type` or `element.props` read went through dynamic dispatch. Typed fields made the one literal that builds elements a single record type. Measured on its own against step 3: create1k −11%, append1k −18%, remove −15%, select −9%, create10k −14%.

## Where the time goes now

create1k at step 4, about 18–21 ms against 7.5–8 ms for JavaScript, from CPU profiles (`profile.mjs`) and in-page timing:

<table>
<thead><tr><th>Part</th><th>Time</th><th>In the JavaScript lane too</th></tr></thead>
<tbody>
<tr><td>DOM work (createElement, setAttribute, appendChild, text)</td><td>about 4.3 ms</td><td>yes, the same calls</td></tr>
<tr><td>The page's replay of the stream beyond that DOM work</td><td>about 1.5–2 ms (0.5 ms of it decoding)</td><td>no</td></tr>
<tr><td>Garbage collection</td><td>about 1–2 ms</td><td>similar share</td></tr>
<tr><td>Compiled React</td><td>about 11–12 ms</td><td>React's own code: about 4.5 ms</td></tr>
</tbody>
</table>

The remaining gap is mostly compiled React running about 2.5× slower than JIT-compiled JavaScript React. React's own quadratic `getHostSibling` scan is the largest single function in both lanes, and here it runs about 2.5× slower. Number fields are f64, so `fiber.flags & Placement` converts on every read, and module constants carry initialization checks. Props, `stateNode` and other slots React types as `any` are read through dynamic dispatchers.

## Tried and dropped

- **Int32 class fields** (store `flags`, `lanes`, `tag` as i32, using the existing int32 slot analysis). None of the fiber's fields qualify. Fibers reach untyped slots at 78 sites in the reconciler (`stateNode`, `memoizedState`, `updateQueue`, event dispatch queues), so the dynamic write paths the compiler generates for the fiber class can store any number into those fields. The constructor's parameter writes aren't proven int32 either. A representation with a fallback (an i32 with a sentinel, the f64 kept elsewhere) would add a compare to every read, for at most about 28 bytes per fiber and a few conversions.
- **Removing module-constant initialization (TDZ) checks** in functions that only run after initialization. An unsafe build with every such check removed was no faster than the normal build, within noise, so the safe version was not built.
- **Batching the page's replay.**
  - Appending 1,000 finished rows through a `DocumentFragment` (or `append(...rows)`) instead of 1,000 `appendChild` calls saves 0.1 ms (0.5 → 0.4 ms). It also changes what a `MutationObserver` sees, one record instead of 1,000.
  - Passing the same string objects instead of fresh substrings saves about 15% of `setAttribute` (1.3 against 1.5 ms per 7,000 calls).
  - A symbol-keyed handle property on each node costs nothing measurable.
  - Pure decoding of create1k's 27,000 commands takes 0.5 ms.
- **Skipping the class-dispatch chain for arrays, strings and numbers** in property-read dispatchers. Neutral in a same-session A/B; not landed.
- **Dropping the fiber's ten dev-only optional fields** (26 struct fields instead of 36). Neutral; kept, since it costs nothing.
- **Compiled symbols** (so `$$typeof === REACT_ELEMENT_TYPE` is a reference compare, not a host call). The whole host-call path is 1–3% of profile samples, so at most about 2%. Not built.

## What would close the rest

- **Typing React's remaining hot untyped slots,** as step 4 did for elements: `stateNode` by fiber tag, `updateQueue`, `memoizedState`. This only pays where a slot's values have a fixed shape. Props stay open-ended objects whatever their type says.
- **Integer arithmetic for numeric fields.** This needs either the slots above typed (so int32 fields can be proven) or a checked int32 representation in the compiler.
- **A cheaper replay of the DOM stream.** At most about 1.5–2 ms of create1k, and only part of that is decoding.
