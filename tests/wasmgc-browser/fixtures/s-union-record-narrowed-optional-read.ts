// An optional keyed read on a union the checker narrowed to the record (`typeof includes === "function"` took the other arm): the read goes through the record arm.
// (the WGSL include-resolver shape: `typeof includes === "function" ? includes(name) : includes?.[name]`)
type Includes = Record<string, string> | ((name: string) => string | undefined);
function resolve(includes: Includes | undefined, name: string): string {
  const found = typeof includes === "function" ? includes(name) : includes?.[name];
  if (found === undefined) return "unknown:" + name;
  return found;
}
console.log(resolve({ a: "A" }, "a"), resolve((n) => n + "!", "b"), resolve(undefined, "c"));
