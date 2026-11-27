// @options: {"interfaceClassArms": true}
interface Props { a?: number; b?: string }
const fragments: (Partial<Props> | undefined)[] = [{ a: 1 }, undefined, { b: "q" }];
let layers: Partial<Props> | undefined;
for (const fragment of fragments) {
  if (fragment) Object.assign((layers ??= {}), fragment);
}
console.log(JSON.stringify(layers ?? null));
