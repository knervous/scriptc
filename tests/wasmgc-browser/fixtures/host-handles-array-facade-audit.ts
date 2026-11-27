// @options: {"hostHandles": true}
// @native-any-only: match results carry index/input/groups only where untyped code receives them (TS any)
// @native-sim-skip: the page-side audit (auditArrayFacade) reads the compiled array through its web facade proxy; the native host answers page reads of compiled values through its own handles, which the simulation does not model
// The page sees a dyn array's named properties through the array's facade (get/has/ownKeys/descriptors/set/delete/define).
const h: any = globalThis;
const text: string = h.auditIdentity("ab 12-zed cd");
console.log(h.auditArrayFacade(/(\d+)-(x)?(\w+)/.exec(text)));
