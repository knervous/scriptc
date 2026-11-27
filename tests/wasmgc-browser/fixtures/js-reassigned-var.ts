// JS variables reassigned a different kind than their initializer's type
// (window.event into a number var, as React does): reads see the stored value.
import { report } from "./js-reassigned-var-helper.js";
const text: string = report();
console.log(text);
