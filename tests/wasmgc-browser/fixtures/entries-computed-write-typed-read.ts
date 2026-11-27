// @native-only: the engine dyn lane has no dynIterN lowering for Object.entries over unknown
// A typed record walked as `unknown` (Object.entries, computed writes into a `{}` literal) and read back through a typed
// check keeps every key, arrays included: the shape of the client's old resolveFxParams, whose full-client build lost
// `emitters` ("expected array at $[0].emitters"). That failure is not reproduced here; this pins the expected result.
interface Emitter { readonly target: string; readonly period: { readonly kind: string; readonly value?: number } }
interface Group { readonly id: string; readonly maxCount: number; readonly emitters: readonly Emitter[]; readonly tags?: readonly string[] }
function rebuild(groups: readonly Group[]): readonly Group[] {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (object.kind === "param") return { kind: "const", value: 1 };
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(object)) out[key] = walk(inner);
    return out;
  };
  return walk(groups) as readonly Group[];
}
const parsed = JSON.parse('[{"id":"a","maxCount":3,"emitters":[{"target":"b","period":{"kind":"param"}}],"tags":["x"]},{"id":"b","maxCount":1,"emitters":[]}]') as Group[];
for (const source of [parsed, [{ id: "c", maxCount: 2, emitters: [{ target: "c", period: { kind: "const", value: 4 } }] }] as Group[]]) {
  const out = rebuild(source);
  console.log(out.length, out.map((g) => `${g.id}:${g.emitters.length}:${g.emitters.map((e) => `${e.period.kind}${e.period.value ?? ""}`).join("|")}:${g.tags?.join(",") ?? "-"}`).join(" "));
}
