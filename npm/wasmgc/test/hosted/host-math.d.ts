// A typed host module: the embedder supplies its functions to instantiateWasmGc({ modules }).
declare module "host:math" {
  export function scale(x: number): number;
  export function name(): string;
  export function later(x: number): Promise<number>;
}
