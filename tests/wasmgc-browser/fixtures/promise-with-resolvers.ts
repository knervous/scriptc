// Promise.withResolvers: a pending promise plus its resolve/reject, for a
// number, a string, void and an object, with later and double settlement.
const { promise, resolve } = Promise.withResolvers<number>();
promise.then((v) => console.log("got", v));
resolve(5);
resolve(6);

const text = Promise.withResolvers<string>();
text.promise.then((v) => console.log("text", v), () => console.log("never"));
text.resolve("hello");

const failing = Promise.withResolvers<number>();
failing.promise.then(() => console.log("never"), () => console.log("rejected"));
failing.reject(new Error("boom"));

const unit = Promise.withResolvers<void>();
unit.promise.then(() => console.log("unit done"));
setTimeout(() => unit.resolve(), 1);

interface Job { id: number }
const job = Promise.withResolvers<Job>();
const waiters: Promise<number>[] = [job.promise.then((j) => j.id * 2), job.promise.then((j) => j.id + 1)];
job.resolve({ id: 20 });

async function main(): Promise<void> {
  const gate = Promise.withResolvers<string>();
  setTimeout(() => gate.resolve("gate open"), 2);
  console.log(await gate.promise);
  console.log("waiters", await Promise.all(waiters));
  await unit.promise;
  console.log("end");
}
void main();
