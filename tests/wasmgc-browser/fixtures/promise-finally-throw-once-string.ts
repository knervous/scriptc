// @native-any-only: the engine lane loses a thrown non-Error value across catch (separate limitation)
// The audit case: a cleanup throwing a string runs once.
let calls = 0;
function cleanup(): void { calls++; throw "cleanup"; }
async function main(): Promise<void> { try { await Promise.resolve(7).finally(cleanup); } catch (e) { console.log("caught", e, calls); } }
void main();
export {};
