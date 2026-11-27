// @native-only: engine dyn cannot hand a page rejection reason to an unknown-typed handler parameter (a separate engine gap)
// @profile: the gate's page provides no external module namespaces, so import() of a package outside the program rejects as a failed import (a TypeError the program can catch); Node loads it
// @expect: before
// @expect: rejected true
// import(pkg) of a module outside the program answers a page promise of its namespace (host island.importDyn),
// lazily (game-manager.ts getInitializedHavok `import("@babylonjs/havok")`).
console.log("before");
import("binaryen").then(
  () => console.log("loaded"),
  (e: unknown) => console.log("rejected", String(e).startsWith("TypeError")),
);
