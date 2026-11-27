// No class this module sees overrides f, so its frontend calls this.f() statically.
export class Base {
  f(): number {
    return 1;
  }
  g(): number {
    return this.f() + 10;
  }
}
