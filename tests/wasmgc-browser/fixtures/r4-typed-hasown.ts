// React's createElement prop copy over a typed record: for-in plus Object.prototype.hasOwnProperty.call.
import { copyOwn } from './r4-typed-helper.js';
const config: { items: string[]; key: string; n: number } = { items: ["a", "b"], key: "k", n: 1 };
const r: string = copyOwn(config);
console.log(r);
