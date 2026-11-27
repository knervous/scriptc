// A local variable named `module` read through a shorthand property (`{ module, varName }`) is no reference to the CommonJS
// `module` binding: it must not switch the CommonJS module graph on (react-router's chunk file does exactly this).
interface Entry { module: string; varName: string }
function entries(names: string[]): Entry[] {
  return names.map((module, i) => {
    const e: Entry = { module, varName: "r" + i };
    return e;
  });
}
console.log(entries(["a", "b"]).map((e) => e.module + ":" + e.varName).join(","));
