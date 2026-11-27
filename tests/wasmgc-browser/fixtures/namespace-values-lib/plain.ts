export function pipelineFor(n: number): string {
  return `plain:${n}`;
}
export function trace(label: string): string {
  return `trace ${label}`;
}
export let hits = 0;
export function hit(by: number): void {
  hits += by;
}
