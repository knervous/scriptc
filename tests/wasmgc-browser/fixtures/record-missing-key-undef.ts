interface Entry { n: number; s: string }
interface Manifest { meshes?: Readonly<Record<string, Entry>> }
const man: Manifest = { meshes: { a: { n: 1, s: "x" } } };
const none: Manifest = {};
function look(m: Manifest | undefined, id: string): string {
  const entry = m?.meshes?.[id];
  if (!entry) return "null";
  return entry.s + entry.n;
}
console.log(look(man, "a"), look(man, "b"), look(none, "a"), look(undefined, "a"));
const rec: Record<string, { n: number }> = { p: { n: 5 } };
const fb = { n: -1 };
function viaNullish(k: string): number { return (rec[k] ?? fb).n; }
console.log(viaNullish("p"), viaNullish("q"));
function viaAnnot(k: string): string {
  const x: { n: number } | undefined = rec[k];
  return x === undefined ? "undef" : "n" + x.n;
}
console.log(viaAnnot("p"), viaAnnot("q"));
function viaIf(k: string): string { if (rec[k]) return "has"; return "no"; }
console.log(viaIf("p"), viaIf("q"));
function viaChain(k: string): number | undefined { return rec?.[k]?.n; }
console.log(viaChain("p"), viaChain("q"));
const strs: Record<string, string> = { a: "A" };
function viaStr(k: string): string { return strs[k] ?? "dflt"; }
console.log(viaStr("a"), viaStr("z"));
function getRet(k: string): { n: number } | undefined { return rec[k]; }
console.log(getRet("p")?.n, getRet("q") === undefined);
function getStrLen(k: string): number | undefined { return strs[k]?.length; }
console.log(getStrLen("a"), getStrLen("zz"));
