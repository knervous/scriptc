// A project tsconfig that turns `strict` off (strictNullChecks stays on). The
// strict family is required, not adopted: the build fails with SC0002 naming
// `strict`, and the checker runs with strictPropertyInitialization on, so
// tsc's own error names each initializer-less field no constructor assigns
// (`Bad`, `Worse`). `Ok` assigns its fields unconditionally and passes.
// Before the family was required, `Bad` compiled with a deferred init (the
// slot rode `T | undefined`) and `Worse` was fenced: a map-typed field has
// no deferral union.

class Ok {
  n: number;
  s: string;
  constructor(n: number) {
    this.n = n;
    this.s = "ok";
  }
}

class Bad {
  v: number; // TS2564: assigned only in a method
  m(): void {
    this.v = 1;
  }
}

class Worse {
  m: Map<string, number>; // TS2564: assigned only in a method
  fill(): void {
    this.m = new Map();
  }
}

console.log(new Ok(5).n);
new Bad();
new Worse();
