// @native-any-only: the default lane keeps TS any as host values, where ++ on a binding is refused
// Statement-position ++/-- on TS any bindings: ToNumeric then step, like JS.
function counter(t0: any) { let { n } = t0; n++; return n; }
function down(t0: any) { let n = t0.n; n--; --n; return n; }
console.log(counter({ n: 4 }), counter({ n: "4" }), counter({ n: null }), counter({}), down({ n: true }));
