// @native-only: engine lane cannot invoke this compiled callback through a page-global property
import { report } from './js-spread-call-helper.js';
const page: any = globalThis;
console.log(report(page));
