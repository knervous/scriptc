import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { clearResolveCaches, projectDtsRuntimeSibling, resolveProjectModule, resolveWorkspaceSourceModule, setProjectPathMappings, setProjectRealm } from "./resolve.js";

const fixturesRoot = join(import.meta.dirname, "../../../..", "tests/fixtures");

test("resolver reset clears the active project package realm", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-resolve-reset-"));
  try {
    const src = join(dir, "src");
    const declaration = join(src, "value.d.ts");
    const runtime = join(src, "value.js");
    await mkdir(src);
    await Promise.all([
      writeFile(join(dir, "package.json"), '{"type":"module"}\n'),
      writeFile(declaration, "export declare const value: number;\n"),
      writeFile(runtime, "export const value = 1;\n"),
    ]);

    clearResolveCaches();
    setProjectRealm(join(src, "main.ts"));
    expect(projectDtsRuntimeSibling(declaration)).toBe(runtime);
    setProjectPathMappings({ "@app/value": [join(src, "value")] });
    expect(resolveProjectModule(join(src, "main.ts"), "@app/value")).toBe(runtime);

    clearResolveCaches();
    expect(projectDtsRuntimeSibling(declaration)).toBeNull();
    expect(resolveProjectModule(join(src, "main.ts"), "@app/value")).toBeNull();
  } finally {
    clearResolveCaches();
    await rm(dir, { recursive: true, force: true });
  }
});

test("source-only workspace packages are project modules while JavaScript packages stay external", () => {
  const sourceEntry = join(fixturesRoot, "workspace-source/main.ts");
  const sourceDir = realpathSync(join(fixturesRoot, "workspace-source/node_modules/wssource"));
  const sourceModule = join(sourceDir, "index.ts");
  const sourceMember = join(sourceDir, "describe.ts");
  const jsEntry = join(fixturesRoot, "npm/cases/workspace-linked/main.ts");

  clearResolveCaches();
  try {
    expect(resolveWorkspaceSourceModule(sourceEntry, "wssource")?.typesFile).toBe(sourceModule);
    expect(resolveProjectModule(sourceEntry, "wssource")).toBe(sourceModule);
    expect(resolveProjectModule(sourceModule, "./describe.js")).toBe(sourceMember);
    expect(resolveWorkspaceSourceModule(jsEntry, "wslinked")).toBeNull();
    expect(resolveProjectModule(jsEntry, "wslinked")).toBeNull();
  } finally {
    clearResolveCaches();
  }
});

test("compile conditions pick a package imports branch, for the resolver and the checker alike", async () => {
  const { analyze } = await import("../index.js");
  const { setCompileConditions } = await import("./resolve.js");
  const dir = await mkdtemp(join(tmpdir(), "scriptc-resolve-conditions-"));
  try {
    const src = join(dir, "src");
    await mkdir(src);
    await Promise.all([
      writeFile(join(dir, "package.json"), JSON.stringify({ type: "module", imports: { "#host": { wasmgc: "./src/host.link.ts", default: "./src/host.page.ts" } } })),
      writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } })),
      writeFile(join(src, "host.link.ts"), "export function linked(): number { return 1; }\n"),
      writeFile(join(src, "host.page.ts"), "export function paged(): number { return 2; }\n"),
      writeFile(join(src, "main.ts"), 'import { linked } from "#host";\nconsole.log(linked());\n'),
    ]);
    const main = join(src, "main.ts");

    clearResolveCaches();
    setProjectRealm(main);
    expect(resolveProjectModule(main, "#host")).toBe(join(src, "host.page.ts"));
    setCompileConditions(["wasmgc"]);
    clearResolveCaches();
    setProjectRealm(main);
    expect(resolveProjectModule(main, "#host")).toBe(join(src, "host.link.ts"));
    setCompileConditions([]);

    const messages = (r: ReturnType<typeof analyze>) => (r.coverage.diagnostics ?? []).map((d) => d.message).join("\n");
    expect(messages(analyze(main, {}))).toMatch(/linked/);
    expect(messages(analyze(main, { conditions: ["wasmgc"] }))).not.toMatch(/linked/);
  } finally {
    const { setCompileConditions } = await import("./resolve.js");
    setCompileConditions([]);
    clearResolveCaches();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an installed package whose compile-condition entry is TypeScript source is a project module", async () => {
  const { setCompileConditions } = await import("./resolve.js");
  const dir = realpathSync(await mkdtemp(join(tmpdir(), "scriptc-resolve-condition-source-")));
  try {
    const pkg = async (name: string, exports: unknown) => {
      const root = join(dir, "node_modules", name);
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "dist"));
      await Promise.all([
        writeFile(join(root, "src/index.ts"), "export const value: number = 1;\n"),
        writeFile(join(root, "dist/index.js"), "export const value = 1;\n"),
        writeFile(join(root, "dist/index.d.ts"), "export declare const value: number;\n"),
        writeFile(join(root, "package.json"), JSON.stringify({ name, type: "module", exports })),
      ]);
    };
    await Promise.all([
      writeFile(join(dir, "main.ts"), 'import { value } from "condsrc";\nconsole.log(value);\n'),
      pkg("condsrc", { ".": { types: "./src/index.ts", wasmgc: "./src/index.ts", default: "./dist/index.js" } }),
      // The checker's "types" branch answers declarations: the two worlds would load different modules.
      pkg("conddts", { ".": { types: "./dist/index.d.ts", wasmgc: "./src/index.ts", default: "./dist/index.js" } }),
    ]);
    const main = join(dir, "main.ts");
    const source = join(dir, "node_modules/condsrc/src/index.ts");

    clearResolveCaches();
    expect(resolveProjectModule(main, "condsrc")).toBeNull();
    setCompileConditions(["wasmgc"]);
    clearResolveCaches();
    expect(resolveProjectModule(main, "condsrc")).toBe(source);
    expect(resolveProjectModule(main, "conddts")).toBeNull();
  } finally {
    setCompileConditions([]);
    clearResolveCaches();
    await rm(dir, { recursive: true, force: true });
  }
});
