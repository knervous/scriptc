// @native-only: the engine lane has no page form for a typed array's buffer held as a value (a separate engine-model limit)
// A promise resolved with another promise adopts it, never holds it as its value (the client's collision fallback:
// `physicsPack.then((pack) => (pack ? null : fetchCollisionBytes(url)))`, the fetch under a Web Lock whose page
// promise carries the bytes out through a closure). The settled payload here is an ArrayBuffer, a dyn inner, which
// the static promise-or-absent flattening cannot re-tag.
async function download(): Promise<ArrayBuffer> {
  await Promise.resolve();
  return new Uint8Array([1, 2, 3, 4, 5]).buffer;
}

function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  let result: { value: T } | null = null;
  return navigator.locks
    .request(name, async () => {
      result = { value: await run() };
    })
    .then(() => result!.value);
}

function fetchUnderLock(name: string): Promise<ArrayBuffer> {
  return withLock(name, () => download()).then((bytes) => {
    console.log("fetched", bytes.byteLength);
    return bytes;
  });
}

async function pack(): Promise<number | null> {
  await Promise.resolve();
  return null;
}

function view(label: string, bytes: ArrayBuffer | null): void {
  const v = new Uint8Array(bytes!);
  console.log(label, v.length, v[4]);
}

async function main(): Promise<void> {
  // The client's chain: a promise-or-null handler result, its promise from under the lock.
  const later = pack().then((found) => (found ? null : fetchUnderLock("collision")));
  later.catch(() => {});
  view("fallback", await later);
  view("handler promise or null", await pack().then((found) => (found ? null : download())));
  const pending = download();
  view("handler pending promise", await pack().then((found) => (found ? null : pending)));
  // An executor's resolve with a promise: adopted, whether the payload type admits null or not.
  view("resolve with promise", await new Promise<ArrayBuffer | null>((resolve) => resolve(download())));
  view("resolve with promise, typed", await new Promise<ArrayBuffer>((resolve) => resolve(pending)));
  // The first of resolve / reject wins, even while the adopted promise is still pending.
  const first = new Promise<ArrayBuffer>((resolve, reject) => {
    resolve(download());
    reject(new Error("too late"));
  });
  view("resolve then reject", await first);
  const thrown = new Promise<ArrayBuffer>((resolve) => {
    resolve(download());
    throw new Error("too late");
  });
  view("resolve then throw", await thrown);
  const { promise, resolve } = Promise.withResolvers<ArrayBuffer>();
  resolve(download());
  view("withResolvers", await promise);
}
void main();
