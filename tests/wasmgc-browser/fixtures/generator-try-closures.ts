function* loopFinally(): Generator<number, void, undefined> {
  for (let i = 0; i < 4; i++) {
    try {
      if (i === 1) continue;
      if (i === 3) break;
      yield i;
    } finally {
      console.log("cleanup", i);
    }
  }
}
for (const v of loopFinally()) console.log("v", v);

function* nestedCatch(): Generator<string, void, undefined> {
  try {
    try {
      yield "a";
      throw new Error("inner");
    } catch (e) {
      yield "caught " + (e as Error).message;
      throw new Error("again");
    } finally {
      yield "inner finally";
    }
  } catch (e) {
    yield "outer " + (e as Error).message;
  }
}
for (const v of nestedCatch()) console.log(v);

function* captured(start: number): Generator<() => number, void, undefined> {
  for (let i = start; i < start + 3; i++) {
    yield () => i * 2;
  }
}
const fs: (() => number)[] = [];
for (const f of captured(5)) fs.push(f);
console.log(fs.map(f => f()).join(","));

function makeCounter(step: number) {
  let n = 0;
  return function* (): Generator<number, void, undefined> {
    while (n < 3) { n += step; yield n; }
  };
}
const counter = makeCounter(1);
for (const v of counter()) console.log("counter", v);

function* returnInFinally(): Generator<number, number, undefined> {
  try {
    yield 1;
    return 5;
  } finally {
    console.log("fin");
  }
}
const rf = returnInFinally();
console.log(JSON.stringify(rf.next()), JSON.stringify(rf.next()), JSON.stringify(rf.next()));

function* reentrant(): Generator<number, void, undefined> {
  yield 1;
  try { me.next(); } catch (e) { console.log((e as Error).name); }
  yield 2;
}
const me = reentrant();
console.log(JSON.stringify(me.next()), JSON.stringify(me.next()), JSON.stringify(me.next()));

function* thrower(): Generator<number, void, undefined> {
  yield 1;
  throw new Error("body threw");
}
const th = thrower();
th.next();
try { th.next(); } catch (e) { console.log("got", (e as Error).message); }
console.log(JSON.stringify(th.next()));
