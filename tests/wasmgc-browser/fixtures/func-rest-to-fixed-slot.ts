// A forwarder typed `(...args: number[]) => number` fills fixed-arity method slots: the call's
// arguments pack into the rest array.
function forwarder(tag: number): (...args: number[]) => number {
  return (...args: number[]): number => {
    let sum = tag;
    for (const a of args) sum += a;
    return sum + args.length * 100;
  };
}
interface Exports {
  readonly label: string;
  alloc(byteLength: number): number;
  step(now: number): number;
  head(): number;
  init(a: number, b: number, c: number): void;
}
function build(): Exports {
  const alloc = forwarder(1);
  const step = forwarder(2);
  const head = forwarder(3);
  const init = forwarder(4);
  return {
    label: "x",
    alloc,
    step,
    head,
    init: (a: number, b: number, c: number): void => { console.log("init", init(a, b, c)); },
  };
}
const e = build();
console.log(e.alloc(10), e.step(20), e.head());
e.init(1, 2, 3);
const direct: (n: number) => number = forwarder(5);
console.log(direct(7));
export {};
