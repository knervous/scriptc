/// <reference path="./ambient-env.d.ts" />
// String methods on untyped strings through the generic dyn dispatch (an island-held env read, `?? ""` inline):
// a web app's asset-base shape. Each line is Node's answer.
interface Values { readonly [key: string]: string | boolean | undefined; readonly BASE_URL: string }
// B and PADDED are not declared on AmbientEnv: every read below is untyped.
const IMPORT_META_ENV: Values = { BASE_URL: "/", B: "/base/", PADDED: "  a-b-c  " };
const env: Partial<AmbientEnv> | undefined = IMPORT_META_ENV;
console.log(JSON.stringify((env?.MISSING ?? "").trim()), JSON.stringify((env?.PADDED ?? "").trim()));
console.log((env?.PADDED ?? "").trimStart().length, (env?.PADDED ?? "").trimEnd().length, (env?.B ?? "").toUpperCase());
console.log((env?.B ?? "").startsWith("/b"), (env?.B ?? "").endsWith("/"), (env?.B ?? "").startsWith("x", 1));
console.log(JSON.stringify((env?.PADDED ?? "").trim().split("-")), JSON.stringify((env?.B ?? "").split()));
console.log((env?.PADDED ?? "").trim().replace("-", "+"), (env?.PADDED ?? "").trim().replaceAll("-", "+"), "ab".replaceAll("", "."));
console.log((env?.B ?? "").substring(1, 5), (env?.B ?? "").charAt(1), (env?.B ?? "").charCodeAt(0));
console.log((env?.B ?? "").padStart(8, "*"), (env?.B ?? "").padEnd(8), "|", (env?.B ?? "").repeat(2));
try {
  (env?.B ?? "").noSuchMethod();
} catch (e) {
  // The name only: the message spells the callee from source ("(env?.B ?? \"\").noSuchMethod"), V8 "(intermediate value)".
  console.log((e as Error).name, (e as Error).message.endsWith(".noSuchMethod is not a function"));
}
