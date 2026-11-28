// Runs a page program under Node through the exported loader, and says whether it imports any npm package from the page.
import fs from "node:fs";
import { instantiateWasmGc } from "scriptw/host";
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const fromPage = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).some((i) => i.name.startsWith("island."));
const program = await instantiateWasmGc(bytes);
await program.main();
console.log(fromPage ? "npm JavaScript" : "compiled in");
