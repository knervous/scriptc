// @options: {"interfaceClassArms": true}
// Spreading a page value (JSON read off an `any` object) into a scalar array
// literal and onto push: the page's iterator drains and each element validates.
const h: any = globalThis;
const json: any = h.auditIdentity({ nodes: [1, 2, 3], names: ["a", "b"], flags: [true, false], scene: 0 });
const nodes: number[] = [...(json.nodes ?? []), 9];
const names: string[] = ["z", ...json.names];
const flags: boolean[] = [...json.flags];
const missing: number[] = [...(json.absent ?? [])];
const pending: number[] = [...json.nodes];
pending.push(...(json.nodes ?? []));
pending.push(...(json.absent ?? []));
console.log(nodes.join(), names.join(), flags.join(), missing.length, pending.join());
const text: string[] = [...json.names[0]];
console.log(text.join("|"));
