// Module C: a subclass of A's class, and a value of A's record type.
import { Shape, Size, scale } from "./geom";

export class Square extends Shape {
  constructor(public side: number) {
    super("square");
  }
  area(): number {
    return scale(this.side, this.side);
  }
}

export function squareSize(s: Square): Size {
  return { w: s.side, h: s.side };
}
