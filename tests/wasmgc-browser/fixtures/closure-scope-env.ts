// Closure conversion over shared scope structs (scope-env.ts): closures created in one scope share
// one struct holding the captured variables it declares; per-iteration scopes, nested scopes,
// recursion, parameters, block/try/catch/finally/switch scopes, writes after capture, callbacks
// passed to array methods (closure-scope-env-async: an async function sharing a captured variable).
// @hits(native,native-any): ^\$arr\.(find|filter|some)\.fn\.
import { shared, callbacks, nonArrays } from "./closure-scope-env-helper.js";
console.log(shared());
console.log(callbacks(3, 2));
console.log(callbacks(3, 9));
// A typed TS array is held in dyn as itself (its own walk, which takes a closure).
const typedNums: number[] = [1, 4, 9];
console.log(nonArrays(4, typedNums), nonArrays(1, typedNums));
// Typed closures (TS) sharing a scope.
function makeAccount(owner: string, balance: number) {
  let history: string[] = [];
  const deposit = (n: number) => { balance += n; history.push("+" + n); return balance; };
  const withdraw = (n: number) => { if (n > balance) return false; balance -= n; history.push("-" + n); return true; };
  const report = () => owner + " " + balance + " [" + history.join(",") + "]";
  return { deposit, withdraw, report };
}
const acct = makeAccount("ann", 10);
acct.deposit(5); acct.withdraw(3); acct.withdraw(100);
console.log(acct.report(), makeAccount("bob", 0).report());
const adders: (() => number)[] = [];
for (let i = 0; i < 4; i++) { const k = i * i; let t = 0; adders.push(() => (t += k)); adders.push(() => t); }
console.log(adders.map(f => f()).join(","), adders.map(f => f()).join(","));
