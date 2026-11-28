// The loader for a module scriptw built: instantiate it with its host imports and run it, in a web page or under Node.
// Import it as `scriptw/host`. It has no Node-only dependencies.
export {
  instantiateWasmGc,
  loadWasmGc,
  chooseVariant,
  detectCapabilities,
  requiredCapabilities,
  deploymentCapabilities,
  requireDeploymentCapabilities,
  createTaskRing,
  runTaskConsumer,
  taskRingBytes,
  STATUS_CANCELLED,
  STATUS_STALE,
  STATUS_FAILED,
  RING_FULL,
  RING_STOPPED,
  RING_BAD_PUBLISH,
} from "../packages/compiler/dist/backend/wasmgc/host.js";
