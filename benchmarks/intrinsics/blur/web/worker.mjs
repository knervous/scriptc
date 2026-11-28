// One blur worker: its own instance of the compiled module on the page's shared memory; each message runs one round.
import { instantiateLinked } from "/dist/backend/wasmgc/host.js";
import { args } from "/blur/shared-layout.mjs";

onmessage = async ({ data }) => {
  try {
    const linked = await instantiateLinked(data.module, { blur: {} }, { env: { memory: data.memory } });
    await linked.modules.blur.main();
    const blur = linked.modules.blur.exports;
    onmessage = () => postMessage(blur.work(...args.work));
    postMessage("ready");
  } catch (e) { postMessage({ error: String(e?.stack ?? e) }); }
};
