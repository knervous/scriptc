// Namespace-or-null locals captured by a returned object's method and
// narrowed there (`if (on && vat) vat.f()`), and an undefined-armed
// namespace from a module-level promise cache (`p ??= import(...)`).
import type * as Plain from "./namespace-values-lib/plain.ts";
let cache: Promise<typeof Plain> | undefined;
function loadPlain(): Promise<typeof Plain> {
  return (cache ??= import("./namespace-values-lib/plain.ts"));
}
async function prepare(useTrace: boolean, useDetail: boolean): Promise<{ draw(on: boolean): string }> {
  const vat = useTrace ? await import("./namespace-values-lib/plain.ts") : null;
  const detail = useDetail ? await import("./namespace-values-lib/detailed.ts") : null;
  return {
    draw(on: boolean): string {
      if (on && vat) return vat.trace("captured");
      else if (detail) return detail.pipelineFor(5);
      return "none";
    },
  };
}
async function main(): Promise<void> {
  const a = await prepare(true, false);
  const b = await prepare(false, true);
  console.log(a.draw(true), a.draw(false), b.draw(true));
  const registry = Math.random() < 2 ? await loadPlain() : undefined;
  console.log(registry ? registry.trace("cached") : "absent", (await loadPlain()) === registry);
}
void main();
