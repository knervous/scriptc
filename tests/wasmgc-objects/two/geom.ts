export function scale(x: number, k: number): number {
  return x * k;
}

export class Shape {
  constructor(public name: string) {}
  area(): number {
    return 0;
  }
  describe(): string {
    return this.name + " area " + this.area();
  }
}

export class Rect extends Shape {
  constructor(public w: number, public h: number) {
    super("rect");
  }
  area(): number {
    return this.w * this.h;
  }
}
