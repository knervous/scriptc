// A const snapshot of a standard-library global (Scheduler's `const localDate = Date`) is the global itself.
const localDate = Date;
const initialTime = localDate.now();
const elapsed = () => localDate.now() - initialTime;
const localObject = Object;
console.log(typeof initialTime, elapsed() >= 0, localObject.keys({ a: 1, b: 2 }).join(","));
