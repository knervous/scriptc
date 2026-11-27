// An uncaught rejection ends the program with exit status 1, after the output before it.
async function load(name: string): Promise<number> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1));
  if (name === "missing") throw new RangeError(`no such entry: ${name}`);
  return name.length;
}
async function main(): Promise<void> {
  console.log("found", await load("present"));
  console.log("found", await load("missing"));
  console.log("unreached");
}
main();
