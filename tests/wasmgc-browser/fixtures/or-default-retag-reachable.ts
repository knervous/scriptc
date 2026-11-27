// `a || b || c` whose result re-tags its truthy side into a wider union calls a lifted retag helper by name;
// the helper must be emitted (it is reached only through that `||`). (authoring.ts validateRegionAmbience.)
type Ambience = { bed?: string; bedNight?: string; loops?: string[]; interior?: boolean; space?: { size: number } };
function declares(a: Ambience): string {
  const d = a.bed || a.bedNight || a.loops?.length || a.interior !== undefined || a.space;
  return d ? "yes:" + typeof d : "no";
}
console.log(declares({}), declares({ bed: "rain" }), declares({ loops: ["a", "b"] }), declares({ interior: false }), declares({ space: { size: 2 } }), declares({ loops: [] }));
