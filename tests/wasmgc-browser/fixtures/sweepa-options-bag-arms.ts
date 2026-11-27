// @options: {"interfaceClassArms": true}
// An options interface with optional fields that a narrower record also flows into (so the
// interface becomes an arm union). Object literals passed through optional parameters or
// `T | undefined` / `T | null` slots still build the interface's own record, with spreads,
// conditional fields and computed values.
interface SamplerOptions { address?: string; anisotropy?: number; filter?: string }
interface FullSampler extends SamplerOptions { address: string; anisotropy: number; filter: string; label: string }
function describe(o?: SamplerOptions): string {
  return `${o?.address ?? "-"}/${o?.anisotropy ?? "-"}/${o?.filter ?? "-"}`;
}
function describeNull(o: SamplerOptions | null): string {
  return o === null ? "null" : `${o.address ?? "-"}/${o.anisotropy ?? "-"}`;
}
function viaVariable(opts: SamplerOptions | undefined): string {
  return describe(opts);
}
const full: FullSampler = { address: "clamp", anisotropy: 4, filter: "linear", label: "full" };
console.log(describe(full), describe(), describe({}));
let aniso: number | undefined = Math.floor(0.5) === 1 ? 8 : undefined;
console.log(describe({ address: "wrap", anisotropy: aniso, filter: "nearest" }));
aniso = 16;
console.log(describe({ address: "wrap", anisotropy: aniso }));
const base = { filter: "cubic" };
console.log(describe({ address: "mirror", ...base }));
console.log(describeNull({ address: "repeat", anisotropy: aniso }));
console.log(describeNull(null), describeNull(full));
console.log(viaVariable({ anisotropy: aniso ? 2 : undefined }), viaVariable(full), viaVariable(undefined));
class Holder {
  sampler: SamplerOptions | undefined;
  constructor(tiled: boolean) {
    this.sampler = { address: tiled ? "repeat" : "clamp", anisotropy: tiled ? 2 : undefined };
  }
}
console.log(describe(new Holder(true).sampler), describe(new Holder(false).sampler));
