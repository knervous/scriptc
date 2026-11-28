// Published React as the page's npm modules for a WasmGC build that leaves React as npm JavaScript (build-wasm.mjs
// --published): the loader's `modules`, keyed by the specifiers the compiled app imports.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";

export const modules = { react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient };
