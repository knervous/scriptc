export function run() {
  // symbol keys are not string keys
  const sym = Symbol("hidden");
  const holder = { visible: 1 };
  holder[sym] = 2;
  holder["after"] = 3;
  console.log(Object.keys(holder).join(","), Object.getOwnPropertySymbols(holder).length, holder[sym]);
  for (const k in holder) console.log("in", k, typeof k);
}
