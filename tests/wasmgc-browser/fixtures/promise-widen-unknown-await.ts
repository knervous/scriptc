// A Promise<number> stored in a Promise<unknown>[] and awaited from there.
// @known-defect(engine): the widened promise's settled value comes back as an engine value the await's typed read rejects ('value from JavaScript is not the expected compiled object')
const later = <T>(value: T, ms: number): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
async function main(): Promise<void> {
  const ps: Promise<unknown>[] = [];
  ps.push(later(1, 1).then((n) => { console.log("n", n); }));
  for (let i = 0; i < ps.length; i++) await ps[i]!;
  const qs: Promise<unknown>[] = [];
  qs.push(later(2, 1));
  for (let i = 0; i < qs.length; i++) console.log("q", await qs[i]!);
}
void main();
