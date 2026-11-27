// A resume function stores at each suspension only the locals the resumed code may read and that it ever writes, and loads
// on entry only the locals some state reads. Each case below keeps a value in a local across suspensions that read it, skip
// it, overwrite it or reach it only through a handler, so a store or load pruned wrongly shows as a wrong value.
const tick = (v: number): Promise<number> => new Promise((resolve) => setTimeout(() => resolve(v), 0));
const fail = async (why: string): Promise<number> => { await tick(0); throw new Error(why); };

async function carried(): Promise<string> {
  let kept = 1, overwritten = 2;
  const seen: number[] = [];
  await tick(0);
  overwritten = await tick(20);
  await tick(0);
  for (let i = 0; i < 3; i++) { seen.push(await tick(i) + kept); kept += i; }
  return `${kept} ${overwritten} ${seen.join(",")}`;
}

async function handlers(): Promise<string> {
  let before = "b", inCatch = "", inFinally = "";
  try {
    before = before + (await tick(1));
    await fail("boom");
    before = "unreached";
  } catch (e) {
    inCatch = (e as Error).message + (await tick(2));
  } finally {
    inFinally = before + "+" + (await tick(3));
  }
  let late = 0;
  try { late = await fail("again"); } catch { late = await tick(9); }
  return `${before} ${inCatch} ${inFinally} ${late}`;
}

async function captured(): Promise<string> {
  let count = 0;
  const bump = () => { count += 10; };
  await tick(0);
  bump();
  const mid = count;
  await tick(0);
  bump();
  return `${mid} ${count}`;
}

async function earlyExit(): Promise<string> {
  let total = 0, label = "none";
  outer: for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      total += await tick(i * 10 + j);
      if (j === 2) continue outer;
      if (i === 3) { label = `exit ${i}.${j}`; break outer; }
    }
  }
  return `${total} ${label}`;
}

function* counter(start: number): Generator<number, string, number | undefined> {
  let n = start, untouched = start * 100;
  try {
    while (true) {
      const sent = yield n;
      n += sent ?? 1;
    }
  } finally {
    n += untouched;
  }
}

async function nestedFinally(): Promise<string> {
  const log: string[] = [];
  let outer: { tag: string } | null = { tag: "outer" };
  try {
    let inner: { tag: string } | null = { tag: "inner" };
    try {
      await tick(0);
      log.push(inner.tag);
      inner = null;
      await fail("deep");
    } finally {
      log.push("inner-finally " + (await tick(1)) + " " + String(inner === null));
    }
  } catch (e) {
    log.push("caught " + (e as Error).message);
  } finally {
    await tick(2);
    log.push("outer-finally " + (outer ? outer.tag : "gone"));
    outer = null;
  }
  await tick(3);
  return log.join(" | ") + " " + String(outer === null);
}

async function sharedBox(): Promise<string> {
  // The frame stops needing `box` after the second await; the closure still reads it, so the shared box keeps its value.
  let box: { v: number } | null = { v: 1 };
  const read = () => (box ? box.v : -1);
  await tick(0);
  const first = read();
  await tick(0);
  const keep = read;
  await tick(0);
  box = { v: 2 };
  await tick(0);
  return `${first} ${keep()} ${read()}`;
}

function* guarded(): Generator<number, string, number> {
  let resource: { name: string } | null = { name: "res" };
  try {
    yield 1;
    const used = resource.name;
    resource = null;
    yield used.length;
    yield 3;
    return "end";
  } finally {
    console.log("generator finally", String(resource === null));
  }
}

async function main(): Promise<void> {
  console.log(await carried());
  console.log(await handlers());
  console.log(await captured());
  console.log(await earlyExit());
  const g = counter(5);
  console.log(g.next(0).value, g.next(3).value, g.next(1).value, JSON.stringify(g.return("done")));
  const h = counter(1);
  h.next(0);
  try { h.throw(new Error("thrown in")); } catch (e) { console.log("caught", (e as Error).message); }
  console.log(await nestedFinally());
  console.log(await sharedBox());
  const r = guarded();
  console.log(r.next(0).value, r.next(0).value, JSON.stringify(r.return("early")));
  const t = guarded();
  t.next(0); t.next(0);
  try { t.throw(new Error("into the generator")); } catch (e) { console.log("generator threw", (e as Error).message); }
}
main();
