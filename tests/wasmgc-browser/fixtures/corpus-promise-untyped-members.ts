// A compiled promise held by untyped code crosses as its page Promise (made
// once; it unwraps back): then/catch/finally, chaining through an untyped
// identity, and its toString tag all behave as a Promise. Corpus:
// js-promise-finally-order.
import { promiseMembers } from "./corpus-promise-untyped-members-helper.js";
promiseMembers().then((line) => console.log(line));
