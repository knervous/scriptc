// `import ... from "scriptw"`: the compiler (Node only). The loader is `scriptw/host`, which also runs in a page.
export { compile, formatDiagnostic } from "./compile.mjs";
export { missingWasmFeatures, unsupportedRuntimeMessage } from "./runtime-check.mjs";
