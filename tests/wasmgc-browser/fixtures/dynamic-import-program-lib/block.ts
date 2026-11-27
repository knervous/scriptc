export interface Emitter {
  className: string;
  emit: (input: number) => string;
}
export const emitter: Emitter = { className: "InputBlock", emit: (input) => `in:${input}` };
export let loads = 0;
loads += 1;
export function scale(value: number): number {
  return value * 2;
}
