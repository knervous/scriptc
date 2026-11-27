// Partial<I> / Readonly<I> over a declaration-file interface (Vite's ImportMetaEnv shape: declared fields
// plus Record<string, any>), filled from a compiled record (what the prepass's generated wasmgc-env.ts holds):
// the slot is the page's object, read through optional chains.
interface EnvValues {
  readonly [key: string]: string | boolean | undefined;
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly VITE_ASSET_BASE: string | undefined;
}
const VALUES: EnvValues = { BASE_URL: "/", MODE: "test", DEV: true, VITE_ASSET_BASE: " /cdn/ " };
const viteEnv: Partial<PageEnv> | undefined = VALUES;
const base = (viteEnv?.VITE_ASSET_BASE ?? "").trim();
console.log(base, viteEnv?.MODE, viteEnv?.DEV, viteEnv?.BASE_URL);
const none: Partial<PageEnv> | undefined = undefined as Partial<PageEnv> | undefined;
console.log((none?.VITE_ASSET_BASE ?? "none").trim(), none?.MODE === undefined);
function read(env: Readonly<PageEnv>): string { return env.MODE + ":" + String(env.DEV); }
console.log(read(VALUES as unknown as PageEnv));
