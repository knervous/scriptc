// Promise.all over promises of different types: results by position, a
// nullable entry, three entries, and fail-fast rejection (the first to
// reject in time wins, not the first in the list).
class Atlas {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const later = <T>(value: T, ms: number): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const fail = <T>(reason: string, ms: number): Promise<T> => new Promise<T>((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
async function main(): Promise<void> {
  const [atlas, count] = await Promise.all([later(new Atlas("body"), 5), later(42, 1)]);
  console.log(atlas.name, count + 1);
  const findOverride = async (): Promise<Atlas | null> => null;
  const maybe = findOverride();
  const [label, override] = await Promise.all([later("skin", 2), maybe]);
  console.log(label, override === null);
  const [a, b, c] = await Promise.all([later(1, 3), later("two", 2), later(true, 1)]);
  console.log(a, b, c);
  try {
    await Promise.all([later("slow", 20), fail<number>("fast", 2)]);
  } catch (error) {
    console.log("rejected", error instanceof Error ? error.message : String(error));
  }
}

// A discarded Promise.all: void promises, a value promise, a null entry, a
// promise-or-null entry and an optional call's promise-or-undefined.
class Meshes {
  async prepare(): Promise<void> {
    console.log("prepared");
  }
}
async function discarded(withMeshes: boolean, gate: boolean): Promise<void> {
  const meshes: Meshes | undefined = withMeshes ? new Meshes() : undefined;
  await Promise.all([later(1, 2), gate ? later("gated", 1) : null, null, meshes?.prepare()]);
  console.log("all settled", withMeshes, gate);
}
void main().then(() => discarded(true, true)).then(() => discarded(false, false));
