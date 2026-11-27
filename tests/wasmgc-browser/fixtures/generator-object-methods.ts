// @options: {"interfaceClassArms": true}
interface Source { next(): Generator<number, string, undefined> }
class Impl implements Source {
  *next(): Generator<number, string, undefined> { yield 1; return "x"; }
}
const src: Source = new Impl();
const it = src.next();
console.log(JSON.stringify(it.next()), JSON.stringify(it.next()));
function* pass(g: Generator<number, void, undefined>): Generator<number, void, undefined> {
  for (const v of g) yield v * 2;
}
function* base(): Generator<number, void, undefined> { yield 1; yield 2; }
for (const v of pass(pass(base()))) console.log(v);
