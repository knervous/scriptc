// @native-only: guarded property reads over shape, prototype, accessor and freeze changes (class facades are native-only)
import { shapes } from "./audit-guarded-shapes-helper.js";
const page: any = globalThis;
console.log(shapes(page));
