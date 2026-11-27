import { DYN } from "../ir.js";
import { defineLibFnSignatures } from "./shared.js";

/** The host builtin call slots. */
export const hostSignatures = defineLibFnSignatures({
"host.call": { argTypes: [], result: DYN },
});
