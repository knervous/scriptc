// @native-only: the engine lane refuses dynCheck to bytes (the FxImage check) before this case is reached
// Records read through dyn ($typed.get, $typed.hasOwn) by every declared field, in shapes whose field atoms lie far apart.
// The field dispatch was a jump table over atoms that used to decline past 8192 of them, and the page-object miss block
// after it then answered undefined for every declared field: in the whole client, a Promise<DecodedImage> awaited as
// Promise<FxImage> copied {width, height, data} as three undefineds ("expected Uint8Array | Uint8ClampedArray at
// .data, got undefined"; every FX texture). Records now dispatch by type index (docs-draft/DESCRIPTOR_DISPATCH.md),
// each shape reading its own fields.
interface DecodedImage { width: number; height: number; data: Uint8Array }
interface FxImage { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray }
interface Mip { width: number; height: number; data: Uint8Array; layerIndex?: number }
interface Light { position: number; range: number; intensity: number; color: string }
interface Zeta { zeta: number; omega: string }
async function decode(): Promise<DecodedImage> {
  await Promise.resolve();
  return { width: 4, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) };
}
const asFx = (): Promise<FxImage> => decode();
const mips: Mip[] = [{ width: 2, height: 2, data: new Uint8Array(4), layerIndex: 1 }, { width: 1, height: 1, data: new Uint8Array(1) }];
const light: Light = { position: 3, range: 9, intensity: 0.5, color: "amber" };
const zeta: Zeta = { zeta: 7, omega: "last" };
void (async () => {
  const image = await asFx();
  console.log(image.width, image.height, image.data.length, image.data[7]);
  for (const value of [mips[0], mips[1], light, zeta] as unknown[]) {
    const record = value as Record<string, unknown>;
    console.log(Object.keys(record).join(","), "width" in record, "zeta" in record, JSON.stringify(record));
    console.log(String(record["width"]), String(record["range"]), String(record["omega"]), String(record["layerIndex"]));
  }
})();
