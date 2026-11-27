// A Vite app's import.meta.env shape: a typed record (string | boolean | undefined values) read through an `any`-
// indexed interface, then string methods on the result.
interface Values { readonly [key: string]: string | boolean | undefined; readonly BASE_URL: string; readonly MODE: string; readonly DEV: boolean; readonly PROD: boolean; readonly SSR: boolean; readonly VITE_WT_HOST: string | undefined }
interface Env extends Record<string, any> { BASE_URL: string; MODE: string; DEV: boolean; PROD: boolean; SSR: boolean }
const IMPORT_META_ENV: Values = { BASE_URL: "/", MODE: "development", DEV: true, PROD: false, SSR: false, VITE_WT_HOST: undefined };
const viteEnv: Partial<Env> | undefined = IMPORT_META_ENV;
const configuredBase = (viteEnv?.VITE_ASSET_BASE ?? "").trim();
console.log(JSON.stringify(configuredBase), (viteEnv?.BASE_URL ?? "./").startsWith("/"), viteEnv?.VITE_ASSETS_ENCRYPTED === "true");
