// await of an untyped value in a JS async function: PromiseResolve, then the ordinary await (zod parseAsync).
import { next } from "./libs-await-dyn-helper.js";
next(Promise.resolve(41)).then((v) => console.log("async", v));
