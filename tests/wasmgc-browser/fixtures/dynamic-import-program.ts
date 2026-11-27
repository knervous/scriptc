// Browser target: import() of one of the program's own modules resolves to
// that compiled module's namespace (typed, by reference), initialized once on
// first import, never a page-side snapshot.
import * as blockNs from "./dynamic-import-program-lib/block.ts";
type BlockModule = typeof import("./dynamic-import-program-lib/block.ts");
const loaders: Record<string, () => Promise<BlockModule>> = {
  InputBlock: () => import("./dynamic-import-program-lib/block.ts"),
};
async function main(): Promise<void> {
  console.log("before");
  const first = await loaders["InputBlock"]!();
  const second = await import("./dynamic-import-program-lib/block.ts");
  console.log(first.emitter.className, first.emitter.emit(3), first.scale(21), first.loads, second.loads);
  console.log(first.emitter === second.emitter);
  // A namespace import used as a value is the same compiled module.
  const holder: { ns: BlockModule } = { ns: blockNs };
  console.log(holder.ns.scale(5), holder.ns.emitter === first.emitter);
  // Destructuring a namespace reads its exports (live), from import() or import * as.
  const { scale, emitter: picked } = await import("./dynamic-import-program-lib/block.ts");
  const { loads: count = -1 } = blockNs;
  console.log(scale(4), picked === first.emitter, count);
}
void main();
