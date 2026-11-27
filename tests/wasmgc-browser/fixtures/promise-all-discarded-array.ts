// A discarded Promise.all over a Promise<unknown>[] (entries collected with
// .catch handlers): the combined value is never read, every entry settles
// before the await resumes, and a rejection still rejects the whole.
// @known-defect(engine): the same widened-promise defect as promise-widen-unknown-await (a Promise<void> stored as Promise<unknown> and awaited)
class Sprite {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}
const later = <T>(value: T, ms: number): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const fail = (reason: string, ms: number): Promise<Sprite> =>
  new Promise<Sprite>((_, reject) => setTimeout(() => reject(new Error(reason)), ms));

async function upload(ids: string[], failing: string | null): Promise<void> {
  const uploads: Promise<unknown>[] = [];
  const settled: string[] = [];
  for (const id of ids) {
    const load = id === failing ? fail(`missing ${id}`, 2) : later(new Sprite(id), 1 + ids.indexOf(id));
    uploads.push(load.then((sprite) => { settled.push(sprite.id); }).catch((reason: unknown) => {
      settled.push(`warned ${reason instanceof Error ? reason.message : String(reason)}`);
    }));
  }
  await Promise.all(uploads);
  console.log(settled.length, settled.join(","));
}

async function strict(): Promise<void> {
  const pending: Promise<Sprite>[] = [later(new Sprite("a"), 3), fail("broken", 1)];
  try {
    await Promise.all(pending);
    console.log("unexpected");
  } catch (error) {
    console.log("rejected", error instanceof Error ? error.message : String(error));
  }
}

void upload(["oak", "ash", "elm"], "ash").then(() => upload([], null)).then(strict);
