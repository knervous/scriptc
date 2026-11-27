// @native-only: the engine lane answers this await with "value from JavaScript is not the expected compiled object", before and after this change
// An awaited promise typed with one record shape, produced by a function returning another (`Promise<DecodedImage>`
// handed out as `Promise<FxImage>`, whose `data` widens to a union): the unbox checks the record as dyn, copying its
// fields. A record that reached dyn only through the promise was never registered with the dyn runtime, so the copy
// found no keys for its shape and trapped (illegal cast); the client's FX textures all failed to load.
interface DecodedImage { width: number; height: number; data: Uint8Array }
interface FxImage { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray }
interface Io { decodeImage(bytes: Uint8Array): Promise<FxImage>; readonly validate: boolean }
async function decodeInBrowser(bytes: Uint8Array, mime: string): Promise<DecodedImage> {
  await Promise.resolve();
  return { width: bytes.length, height: mime.length, data: new Uint8Array(bytes) };
}
let installed: ((bytes: Uint8Array, mime: string) => Promise<DecodedImage>) | null = null;
function decodeWithHost(bytes: Uint8Array, mime = "image/webp"): Promise<DecodedImage> { return (installed ?? decodeInBrowser)(bytes, mime); }
function decodeImage(bytes: Uint8Array): Promise<FxImage> { return decodeWithHost(bytes, "image/png"); }
function io(): Io { return { validate: true, decodeImage }; }
class Library {
  readonly io: Io;
  constructor(io: Io) { this.io = io; }
  async load(): Promise<FxImage | null> {
    try { return await this.io.decodeImage(new Uint8Array([1, 2, 3])); }
    catch (error) { console.log("failed", String(error)); return null; }
  }
}
new Library(io()).load().then((img) => console.log(img ? `${img.width}x${img.height} ${img.data.length}` : "null"));
