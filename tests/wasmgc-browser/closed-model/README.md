# Closed scalar-record proof

Run `node prove.mjs` with Node 26+ from this directory, or run it by path from the compiler fork. It compiles `model.ts` under `experimentalJsSpecialize: 'closed'`, compares dev and optimized execution with Node, and verifies identical bytes to normal typed compilation. The optimized model is 513 bytes. The profile validates existing static lowering; it does not add source-to-source inference.

`owned-scalar-records/1` checks the entire module, including initialization and its default entry. It admits number/boolean scalars, private fixed-field records and a small whitelist of direct operations. Exports accept and return scalars. Dynamic values, open records, host access, reference ingress, closures, asynchronous lifetimes and unknown operations are refused. The refusal report is saved as `.closed.json`; a profile refusal removes the old executable.

`bindClosedExports(instance.exports, report)` checks JS argument count and kinds before calling Wasm and returns actual JS booleans for boolean results. The proof checks object/string/missing arguments and `NaN`, infinity, negative zero and negative numbers. Raw Wasm callers still use the physical scalar ABI; the binding is not a security boundary or confidentiality guarantee.

The proof merges the compiled model with an independently emitted Wasm caller using pinned wasm-merge 133, restores the host ABI section, initializes the model and verifies a direct scalar call returning 54. The merged artifact is 636 bytes. This caller is Wasm, not a new Rust integration test.

The runner stages a browser smoke test at `wgc-scratch/web/closed-sol/index.html` and saves provenance receipts in `receipts/`. Serve it with the existing COI server. The browser repeats the model trace, checked ingress and merged caller checks.
