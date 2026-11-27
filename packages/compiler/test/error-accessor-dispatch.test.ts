import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../src/index.js";

// Effect 4's Data.Error and PlatformError.SystemError: a subclass replaces its base's `message` field with an
// accessor, and one keyed read sees instances of both. The subclass's key helper compared the base field's type
// against the subclass's own field table, which has no `message`, and lowering crashed reading `kind` of undefined.
// tests/corpus/error-subclass-message-accessor-keyed.js pins the behavior against Node.
test("a keyed read of an Error subclass whose accessor replaces the base's message field lowers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-error-accessor-"));
  try {
    const entry = join(dir, "main.js");
    await writeFile(entry, `const makeBase = function () {
  return class Base extends globalThis.Error {
    constructor(args) {
      super(args?.message);
      if (args) Object.assign(this, args);
    }
  };
};
const Base = makeBase();
class SystemError extends Base {
  get message() { return \`\${this._tag}: \${this.module}.\${this.method}\`; }
}
function read(value, key) { return value[key]; }
const plain = new Base({ message: "plain failure", module: "Path" });
const system = new SystemError({ _tag: "NotFound", module: "FileSystem", method: "open" });
for (const key of ["_tag", "module", "method", "message", "name"]) console.log(key, read(plain, key), read(system, key));
`);
    const result = await compile(entry, { outDir: dir, outPath: join(dir, "main.ir.json"), outputKind: "ir", dynamic: false });
    expect(result.ok ? [] : result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
