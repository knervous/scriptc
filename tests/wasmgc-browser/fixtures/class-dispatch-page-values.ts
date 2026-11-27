// @native-any-only: the read sites are dyn only when TS any is native (class instances through any: defect-class-instance-through-any)
// One constant-key dyn read serving class instances, typed records, native
// objects and page objects: with a class reaching dyn, the class-property
// dispatcher's bag-identity test runs for every receiver kind (ref.eq for
// compiled values, === for page values), a class getter and a NaN field.
// (An object-literal getter here: defect-getter-literal-shared-key.)
class Box { n = 1; get twice() { return this.n * 2; } }
const page: any = globalThis;
const made = page.auditMake();
const values: any[] = [new Box(), made, { n: 3 }, { n: NaN }];
for (const v of values) console.log(String(v.n), v.twice);
made.n = 7; console.log(values[1].n, made === values[1], values[0] === values[0]);
