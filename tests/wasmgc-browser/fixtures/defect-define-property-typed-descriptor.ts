// @native-any-only: Object.defineProperty has no lowering outside TS any
// Regression (formerly a known defect): a TS object literal as the descriptor of Object.defineProperty through TS any.
const o: any = JSON.parse('{"id":1}');
Object.defineProperty(o, "id", { value: 2 });
console.log(o.id, Object.keys(o).join(","));
Object.defineProperty(o, "hidden", { value: 3, enumerable: false });
console.log(o.hidden, Object.keys(o).join(","));
Object.defineProperty(o, "twice", { get() { return o.id * 2; }, enumerable: true });
console.log(o.twice, Object.keys(o).join(","));
