import { probe } from "./js-string-computed-constructor-helper.js";
for (const k of ["constructor", "__proto__"]) console.log(probe(" abc", k));
