// Minimal promise.finally(): its returned promise is used afterwards (then). Every lane lowers a compiled
// zero-parameter callback through the compiled finally (ledger F008 / F048), so the result is a compiled promise.
const a = Promise.resolve();
const t = a.finally(() => { console.log("fin"); });
void t.then(() => console.log("after"));
