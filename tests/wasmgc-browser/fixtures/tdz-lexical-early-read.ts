// let and const bindings read or written through functions before their declarations run throw Node's ReferenceError; afterwards
// they behave normally.
function readLet(): number {
  return counter;
}
function readConst(): string {
  return greeting;
}
function readObj(): number {
  return config.depth;
}
function writeLet(v: number): void {
  counter = v;
}
const attempts: [string, () => unknown][] = [
  ["let", readLet],
  ["const", readConst],
  ["object", readObj],
  ["write", () => writeLet(4)],
];
for (const [label, run] of attempts) {
  try {
    console.log(label, "ok", String(run()));
  } catch (e) {
    console.log(label, (e as Error).name, (e as Error).message, e instanceof ReferenceError);
  }
}
let counter = 1;
const greeting = "hi";
const config = { depth: 3 };
console.log(readLet(), readConst(), readObj());
writeLet(8);
console.log(readLet());
