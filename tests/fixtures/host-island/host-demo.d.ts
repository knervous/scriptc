// The typed host module the stub host (stub-host.c) answers.
declare module "host:demo" {
  export function add(a: number, b: number): number;
  export function greet(name: string): string;
  export function fail(): void;
}
