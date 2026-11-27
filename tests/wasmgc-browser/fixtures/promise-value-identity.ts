// The Promise constructor read as a value is the page's own on the web host (adopted at module start); page and compiled promises interoperate.
import { run } from "./promise-value-identity-helper.js";
run().then((s: string) => console.log(s));
