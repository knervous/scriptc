// A module `let` of a function type declared without an initializer holds undefined once its declaration has run,
// and reads of it from functions then answer undefined, not the temporal dead zone's ReferenceError (a
// renderer's lazily imported material factories).
type Factory = (x: number) => number;

let make: Factory;

function ready(): boolean {
  return !!make;
}

function call(x: number): number {
  return make ? make(x) : -1;
}

async function load(): Promise<void> {
  if (!ready()) {
    await Promise.resolve();
    make = (x) => x * 2 + 1;
  }
}

async function main(): Promise<void> {
  console.log(ready(), call(3));
  await load();
  console.log(ready(), call(3));
  const other: Factory = make;
  console.log(other(5), typeof other);
}

void main();
