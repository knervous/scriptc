// @native-only: the engine lane refuses this callback signature at its dynamic-code boundary (a separate engine-model limit)
// The page calls a compiled callback whose parameters are a typed array, a
// promise and a record: each argument enters through the full browser exit
// (the page view's bytes, an adopted promise, a page-backed record).
const page: any = globalThis;
async function main(): Promise<void> {
  let seen: Promise<number> | null = null;
  const total = page.auditCallWithBytes((bytes: Uint8Array, later: Promise<number>, size: { width: number; height: number }) => {
    seen = later;
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i]!;
    return sum + size.width * size.height;
  });
  console.log(total);
  if (seen) console.log(await seen);
}
void main();
