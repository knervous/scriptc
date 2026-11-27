// @native-any-only: the untyped Promise binding is TS any (the plain native lane keeps the page's)
// The web host: AggregateError is the page's constructor (adopted); a compiled one carries its errors on its page form; Promise.any rejects with the page's.
import { run } from "./aggregate-error-helper.js";
run().then((s: string) => console.log(s));
