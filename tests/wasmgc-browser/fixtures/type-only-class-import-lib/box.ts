// Imported only as a type by type-only-class-import.ts: never evaluated.
console.log("box module evaluated");
export class Box {
  constructor(public v: number) {}
  twice(): number { return this.v * 2; }
}
