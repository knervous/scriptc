# React to TypeScript

`packages/react-ts` is React's own source, converted from Flow and brought to strict TypeScript, so a WasmGC build
compiles React as a typed program instead of the untyped production bundle.

**Pinned upstream:**
- **React:** facebook/react `v19.2.8` (commit 1dd4ecbdabf826f527fc9a58c05ea70375b7d170), MIT.
- **Converter:** stripe-archive/flow-to-typescript-codemod (commit 08afa7af16d1a6021ad20ebfee81146ebda0f184), with `codemod-arrow-parens.patch` applied.

## How the port is made

`build.sh <out>` regenerates the pipeline output:

1. Copy `packages/`, keeping only the forks the browser DOM client build selects (`scripts/rollup/forks.js`).
2. `flow-prepass.py`: rewrite Flow syntax the converter cannot read (component types, `as` casts, `declare` forms, overloads), logging what it changed.
3. Run the Stripe converter.
4. `fold-flags.cjs`:
   - Fold the production client's build constants (`__DEV__`, `__PROFILE__` and `__EXPERIMENTAL__` all false) and the values of React's and the scheduler's feature flags.
   - Resolve the module forks (DOM host config, client shared internals).
   - Keep only what `react-dom/client`, `react-dom`, `react`, `react/jsx-runtime` and `scheduler` reach.
5. `ts-postpass.py`: restore the forms the pre-pass logged (`declare var`, `declare class`, overloads, the `isArray` guard).
6. `dropdead.cjs`: remove statements the folding left unreachable.
7. `dce.cjs`: remove unreferenced declarations and unused imports.

The output is about 530 type errors short of strict. **The hand edits in `packages/react-ts` close that gap.** The main ones:
- **Node record:** React DOM's per-node expandos become one typed record in a WeakMap (`ReactDOMComponentTree.NodeInternals`).
- **Classes:** FiberNode, FiberRootNode, the DOM roots, Component and PureComponent become classes.
- **Honest types:** nullable fields instead of `null as any`, and optional FiberRoot fields for features this build leaves off.
- **Runtime-keyed access:** `shared/dynamicProperty` for property access whose key is only known at run time.
- **Typed views:** precise types for the code's own `any` sites.


Upgrading to a new React tag:
1. Run `build.sh` at the old tag and at the new tag.
2. Three-way merge: old output as the base, new output as theirs, `packages/react-ts` as ours.
3. Bring the merge back to 0 errors under both checkers (below).

## Checks

```bash
cd packages/react-ts && node ../compiler/node_modules/typescript/bin/tsc -p tsconfig.json
```

Run the same with TypeScript 5.9 (`node <typescript 5.9>/bin/tsc -p tsconfig.json`). Both must report 0 errors.

## Helpers for the hand edits

- **`fixnull.cjs`:** adds `!` where the checker reports a possibly-null dereference. These are spots where JavaScript would throw anyway; compiled, they trap.
- **`deany.cjs`:** replaces `as any` / `: any` with the first precise form that keeps the error count unchanged:
  - dropping the cast;
  - a non-null assertion;
  - the contextual type;
  - inference, or `unknown`.
- **`toplevel.cjs`:** lists top-level statements that run code at module load (the fork's import-cycle admission depends on them).
