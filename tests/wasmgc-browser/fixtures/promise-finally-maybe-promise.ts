// finally callback returning `void | Promise<void>`: a rejected promise from
// the cleanup must be awaited and replace the outcome; a resolved one keeps it.
function rejecting(): void | Promise<void> { return Promise.reject("cleanup"); }
function resolving(): void | Promise<void> { return Promise.resolve(); }
function plain(): void | Promise<void> { return undefined; }
async function main(): Promise<void> {
  try { console.log("value", await Promise.resolve(7).finally(rejecting)); }
  catch (e) { console.log("caught", e); }
  console.log("value", await Promise.resolve(8).finally(resolving));
  console.log("value", await Promise.resolve(9).finally(plain));
  try { await Promise.reject("orig").finally(resolving); }
  catch (e) { console.log("caught", e); }
  try { await Promise.reject("orig").finally(rejecting); }
  catch (e) { console.log("caught", e); }
}
void main();
export {};
