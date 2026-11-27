// Runs a module built from scaled.ts under Node through the package's exported loader, supplying host:math.
import fs from "node:fs";
import { instantiateWasmGc } from "scriptw/host";

const program = await instantiateWasmGc(fs.readFileSync(process.argv[2]), {
  modules: {
    "host:math": {
      scale: (x) => x * 10,
      name: () => "scaled",
      later: (x) => new Promise((resolve) => setTimeout(() => resolve(x + 1), 1)),
    },
  },
});
await program.main();
