// An object literal handed to a page function whose parameter is `unknown`
// (React's jsx(type, props: unknown)): built as a page object, each field
// crossing the boundary on its own, nested literals and arrays included.
import { jsx as rawJsx } from "./page-unknown-literal-helper.js";
const jsx = rawJsx as (type: unknown, props: unknown) => string;
function Shell(): string { return "shell"; }
const title = "Legal";
console.log(jsx("div", { className: "page", title, children: [jsx("span", { children: "a" }), "b"] }));
console.log(jsx(Shell, { kicker: "Legal information", title: "Impressum", children: jsx("p", {}) }));
console.log(jsx("button", { disabled: false, onClick: () => 1, style: { color: "red" } }));
