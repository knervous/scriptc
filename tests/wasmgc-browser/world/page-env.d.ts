// A project-declared environment interface shaped like Vite's ImportMetaEnv (declared fields over a
// Record<string, any> reached through a conditional key alias), for the Partial/Readonly-over-a-declared-
// interface fixtures.
interface PageEnvOptions {}
type PageEnvFallbackKey = "strictPageEnv" extends keyof PageEnvOptions ? never : string;
interface PageEnv extends Record<PageEnvFallbackKey, any> {
  BASE_URL: string;
  MODE: string;
  DEV: boolean;
}
