# host-stream

Batched host APIs for WasmGC programs. A program writes commands into an arena in its own memory, and the host replays them in one loop per flush, rather than one host call per operation. The host also writes records into the same arena, which the program reads in place.

- **Format:** every command is `[op, n, args...]` in 32-bit words, `n` the number of argument words, so a reader can skip a command it does not know. Handles and atoms are one word, and an f64 is two. A string is its offset and length in the flush's text: every string of a flush is appended to one JS string, which crosses with the flush. On WasmGC a compiled string is already a JS string, so nothing is encoded or copied on the way. Op 1 defines an atom; ops 16 and up are the schema's.
- **One contract:** a JSON schema lists the commands and records. `src/gen.mjs` generates the compiled side's encoder and record readers (TypeScript) and the host's replay and record writers (JavaScript) from it, so the two sides cannot drift apart.
- **The compiled side:** `src/stream.ts` (`HostStream`) holds the arena, the text and the atoms, and flushes when a command does not fit. Its host module is `host:stream` (`src/host-stream.d.ts`): `attach` once per channel and `flush`.
- **The host side:** `src/host.js` (`createHostStreams`) serves `host:stream` and hands each channel's flushes to its consumer, remaking the views when the memory grows.

```console
$ node packages/host-stream/src/gen.mjs <schema.json> --ts <out.ts> --js <out.js> [--check]
```

`../dom-stream` is the first stream built on it.
