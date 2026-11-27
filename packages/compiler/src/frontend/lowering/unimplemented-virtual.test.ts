import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

test("a release build admits an abstract call on a generic base's instantiation no class in the program extends", async () => {
  // Compact is never reached, but Core<Font, number, CompactOptions> (its base instantiation) keeps `build`, whose abstract calls
  // can never run: no instance of that instantiation can exist (a generic layer core in a large program).
  const dir = mkdtempSync(join(tmpdir(), "unimplemented-virtual-test-"));
  writeFileSync(join(dir, "main.ts"), [
    "interface FontBase { name: string }",
    "interface CoreOptions<TFont extends FontBase> { font?: TFont; depthTest?: boolean }",
    "export abstract class Core<TFont extends FontBase, TMesh, TOptions extends CoreOptions<TFont> = CoreOptions<TFont>> {",
    "  protected mesh: TMesh | null = null;",
    "  protected constructor(protected readonly engine: object, protected options: TOptions) {}",
    "  protected abstract createMesh(font: TFont): TMesh;",
    "  build(font: TFont): void { this.mesh = this.createMesh(font); }",
    "}",
    "interface Font extends FontBase { size: number }",
    "class Glyphs { on = false; }",
    "class Facade extends Core<Font, Glyphs> {",
    "  constructor(engine: object) { super(engine, { depthTest: true }); }",
    "  protected createMesh(font: Font): Glyphs { console.log(font.name); return new Glyphs(); }",
    "}",
    "interface CompactOptions extends CoreOptions<Font> { compact: boolean }",
    "export class Compact extends Core<Font, number, CompactOptions> {",
    "  constructor(engine: object) { super(engine, { compact: true }); }",
    "  protected createMesh(font: Font): number { return font.size; }",
    "}",
    "new Facade({}).build({ name: \"f\", size: 1 });",
  ].join("\n") + "\n");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: join(dir, "main.wasm"), outputKind: "wasmgc", browser: true, dynModel: "native", release: true });
  expect(r.ok ? [] : r.diagnostics.map((d) => d.message)).toEqual([]);
});
