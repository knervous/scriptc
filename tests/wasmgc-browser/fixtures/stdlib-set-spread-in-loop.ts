// Subsystem reduction: chat-filters.ts normalizeChatTabs dedupes each saved tab's kinds with [...new Set(...)] inside a
// loop over an unknown array. The WasmGC lane answered an empty array for every entry after the first (2026-10-26).
type K = 'say' | 'tell' | 'x';
interface Tab { id: string; kinds: K[] }
const known = new Set<string>(['say', 'tell']);
const a: Tab = { id: "a", kinds: ["say", "tell"] };
const b: Tab = { id: "b", kinds: ["tell"] };
const input: unknown = [a, b];
function viaSetSpread(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    const { kinds } = entry as Partial<Tab>;
    const ks = Array.isArray(kinds) ? [...new Set(kinds.filter((kind): kind is K => typeof kind === 'string' && known.has(kind)))] : [];
    out.push(ks.join("+"));
  }
  return out;
}
function viaFilterOnly(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    const { kinds } = entry as Partial<Tab>;
    const ks = Array.isArray(kinds) ? kinds.filter((kind): kind is K => typeof kind === 'string' && known.has(kind)) : [];
    out.push(ks.join("+"));
  }
  return out;
}
function viaSetNoGuard(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    const { kinds } = entry as Partial<Tab>;
    const ks = Array.isArray(kinds) ? [...new Set(kinds)] : [];
    out.push(ks.join("+"));
  }
  return out;
}
function viaSlice(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const entry of value.slice(0, 8)) {
    const { kinds } = entry as Partial<Tab>;
    const ks = Array.isArray(kinds) ? kinds.filter((kind): kind is K => typeof kind === 'string' && known.has(kind)) : [];
    out.push(ks.join("+"));
  }
  return out;
}
console.log(`setSpread ${viaSetSpread(input).join(" | ")}`);
console.log(`filterOnly ${viaFilterOnly(input).join(" | ")}`);
console.log(`setNoGuard ${viaSetNoGuard(input).join(" | ")}`);
console.log(`slice ${viaSlice(input).join(" | ")}`);
console.log(`again ${viaFilterOnly(input).join(" | ")}`);
