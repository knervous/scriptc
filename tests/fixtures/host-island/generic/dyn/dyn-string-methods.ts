// Methods on untyped strings and numbers (an `any` env value through ?? ""): the native dyn tree answers them.
interface Env { readonly [key: string]: any; readonly BASE_URL: string }
const env: Partial<Env> | undefined = { BASE_URL: "/", PADDED: "  x  " };
const base = (env?.VITE_ASSET_BASE ?? "").trim();
const padded = (env?.PADDED ?? "").trim();
console.log(JSON.stringify(base), JSON.stringify(padded), (env?.BASE_URL ?? "").toUpperCase(), (env?.PADDED ?? "").includes("x"));
const n: any = 3.14159;
console.log(n.toFixed(2), JSON.stringify((env?.PADDED ?? "").split("x")), (env?.BASE_URL ?? "").startsWith("/"));
