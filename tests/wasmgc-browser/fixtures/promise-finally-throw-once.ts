// A throwing finally cleanup runs exactly once and its error replaces the outcome.
let calls = 0;
function cleanup(): void { calls++; throw new Error("cleanup"); }
async function main(): Promise<void> {
  try { await Promise.resolve(7).finally(cleanup); } catch (e) { console.log("caught", (e as Error).message, calls); }
  try { await Promise.reject(new Error("orig")).finally(cleanup); } catch (e) { console.log("caught", (e as Error).message, calls); }
}
void main();
export {};
