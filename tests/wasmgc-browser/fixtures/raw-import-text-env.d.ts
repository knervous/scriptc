// The bundler raw-text import declaration (Vite's client types declare it so for the page build).
declare module "*?raw" {
  const src: string;
  export default src;
}
