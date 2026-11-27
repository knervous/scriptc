// Regression (formerly a known defect): an object-literal getter read through a constant-key dyn read shared with another record type declaring the key.
const alone: any = { get n() { return 5; } };
console.log(alone.n);
const vals: any[] = [{ n: 3 }, { get n() { return 5; } }];
for (const v of vals) console.log(v.n);
