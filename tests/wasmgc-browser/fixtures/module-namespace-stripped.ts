// @options: {"stripSourceSites": true}
// Module namespaces in a production build (stripSourceSites): each namespace's runtime id is an opaque hash of its file,
// the same whatever directory the build compiled from, and identity holds between static and dynamic imports.
import * as lib from "./import-then-ns-lib/lib.ts";
import * as again from "./import-then-ns-lib/lib.ts";
console.log(lib === again, lib.f(lib.a));
import("./import-then-ns-lib/lib.ts").then((ns) => {
  console.log(ns === lib, ns.f(3), Object.keys(ns).sort().join(","));
});
