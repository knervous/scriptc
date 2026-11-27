// @native-any-only: TS `any` over a typed match result
// @native-refuses: deleting a typed match result's own index, input or groups from untyped code
// @expect-native: caught TypeError
const a: any = /(\d)/.exec("a1")!;
try {
  delete a.index;
  console.log("deleted", Object.keys(a).join(","));
} catch (e) {
  console.log("caught", (e as Error).name);
}
