// @native-only: the untyped JSON binding
import { run } from "./json-reviver-helper.js";
console.log(run());
const typed = JSON.parse('{"n":1,"list":[1,2,{"z":3}]}', (_key: string, value: unknown) => (typeof value === "number" ? value + 1 : value));
console.log(JSON.stringify(typed));
