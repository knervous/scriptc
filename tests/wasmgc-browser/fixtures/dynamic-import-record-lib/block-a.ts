export interface Emitter { className: string; emit: (input: number) => string }
export const emitter: Emitter = { className: "A", emit: (input) => `a:${input}` };
export const extra = 1;
