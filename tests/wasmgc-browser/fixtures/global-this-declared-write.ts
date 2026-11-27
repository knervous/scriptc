// A declared global written through globalThis (a console debug handle) is a
// page property write; a primitive read-back sees it.
declare global { var __debugTag: string | undefined; var __debugHandle: { count: number } | undefined; }
globalThis.__debugTag = "ready";
globalThis.__debugHandle = { count: 1 };
const tag = String(globalThis.__debugTag);
globalThis.__debugTag = undefined;
globalThis.__debugHandle = undefined;
console.log(tag, String(globalThis.__debugTag));
export {};
