// A cross-origin-isolated static server for the feature-profile probe (build-probe.mjs) and other shared-memory pages:
// every response carries COOP same-origin + COEP require-corp (+ CORP same-origin),
// so pages see crossOriginIsolated === true and may use SharedArrayBuffer.
//   node serve-coi.mjs [port] [root]     (default 8766, .out here; the probe is then at /coi/capabilities.html)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8766);
const root = path.resolve(process.argv[3] ?? path.join(here, ".out"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(root, decodeURIComponent(url.pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" };
    if (err) { res.writeHead(404, headers).end("not found"); return; }
    res.writeHead(200, { ...headers, "Content-Type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  });
}).listen(port, "127.0.0.1", () => console.log(`coi static server http://127.0.0.1:${port}/ -> ${root}`));
