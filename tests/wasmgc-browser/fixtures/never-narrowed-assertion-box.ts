// A value the checker narrows to never (a config constant tested against its only value) asserted to a record type
// and stored into an any-keyed bag (React's injectIntoDevTools with no renderer config): the branch never runs and
// the build stays valid. Same output as Node.
type InspectionConfig = Readonly<Record<any, any>>;
export const extraConfig = null;
function internals(): Record<string, unknown> {
  const bag: Record<any, any> = { bundleType: 0 };
  if (extraConfig !== null) {
    bag.rendererConfig = (extraConfig as InspectionConfig);
  }
  return bag;
}
console.log(Object.keys(internals()).join(","));
export {};
