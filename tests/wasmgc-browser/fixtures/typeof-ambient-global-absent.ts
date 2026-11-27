// `typeof` of a `declare var` global the page never defines (React's DevTools hook probe): 'undefined', no
// ReferenceError, in a module initializer and in a function. Same output as Node.
type Hook = { inject(internals: object): number };
declare var __APP_DEVTOOLS_HOOK__: Hook | undefined;
export const present = typeof __APP_DEVTOOLS_HOOK__ !== "undefined";
function inject(): boolean {
  if (typeof __APP_DEVTOOLS_HOOK__ === "undefined") return false;
  const hook = __APP_DEVTOOLS_HOOK__;
  return hook.inject({}) > 0;
}
console.log(present, typeof __APP_DEVTOOLS_HOOK__, inject());
