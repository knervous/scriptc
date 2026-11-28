// Untyped code: a dynamic import's namespace destructured in the fulfillment handler, with and without a rejection handler.
export function run(scene, builds) {
  return import("./then-namespace-destructure-lib/build.js").then(({ C, label }) => label + " " + C(scene, builds), (error) => {
    console.error(error);
  });
}
export function count() {
  return import("./then-namespace-destructure-lib/build.js").then(({ calls }) => calls);
}
export function labelOf() {
  return import("./then-namespace-destructure-lib/build.js").then((m) => m.label + "!");
}
