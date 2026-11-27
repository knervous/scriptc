// A bundler wildcard module (as Vite's client types declare `*?worker` and `*?url`): one declaration answers every
// specifier the pattern matches.
declare module "*?pagemod" {
  const value: string;
  export default value;
}
