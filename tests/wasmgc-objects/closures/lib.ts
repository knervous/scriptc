// Closures and arrays: the keyed helpers (`%arr.map.<hash>`) both objects reach are COMDATs.
export function mk(k: number): (x: number) => number {
  return (x) => x * k;
}

export function twice(xs: number[]): number[] {
  return xs.map((x) => x * 2);
}

export const LABEL = "lib";
