// A typed host module: the page supplies its functions to instantiateWasmGc({ modules }).
declare module "host:clock" {
  export function now(): number;
  export function label(n: number): string;
  export function wait(ms: number): Promise<string>;
}
