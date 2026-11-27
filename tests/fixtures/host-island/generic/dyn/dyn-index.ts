// Numeric keys on untyped values (the class index dispatchers: dyn.isArrayIndex / isArrayStoreIndex, the typed-array
// and string lanes) and array patterns over untyped sources (dyn.isPristineArrayIterable, dyn.arrayPatternElement).
class Grid { cells = [1, 2]; }
function read(values: any, i: number): string { return String(values[i]); }
function write(values: any, i: number, v: unknown): void { values[i] = v; }
const list: any = [10, 20, 30];
const holes: any = [1, , 3];
const bytes: any = new Uint8Array([7, 8]);
const text: any = "héllo";
const plain: any = { 0: "zero", 1: "one" };
const grid: any = new Grid();
console.log(read(list, 0), read(list, 2), read(list, 3), read(list, 1.5), read(list, -1), read(holes, 1));
console.log(read(bytes, 1), read(bytes, 2), read(text, 1), read(text, 9), read(plain, 1), read(grid, 0));
write(list, 3, 40); write(list, 5, 60); write(bytes, 0, 300); write(plain, 2, "two");
console.log(list.length, String(list), String(bytes), plain[2], read(list, 4));
const frozen: any = [1, 2];
Object.freeze(frozen);
try { write(frozen, 0, 9); console.log("wrote"); } catch (error) { console.log(error instanceof TypeError); }
function pair(source: any): string { const [first, second] = source; return `${first}/${second}`; }
console.log(pair([1, 2, 3]), pair([1]), pair("ab"), pair(new Set(["x", "y"])), pair(holes));
