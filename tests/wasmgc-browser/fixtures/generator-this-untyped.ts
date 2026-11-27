// A generator declared inside a function body of untyped code reads its call-time `this`; interleaved generators keep their own receivers.
import { run } from './generator-this-untyped-helper.js';
console.log(run());
