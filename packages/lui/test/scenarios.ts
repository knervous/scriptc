// The runtime's contract in a real browser document: each scenario runs in a fresh page (lui.test.ts) and answers
// what it saw. Bundled with the runtime by esbuild, `#dom` the page's own DOM.
import {
  afterCommit, delay, Embedded, flushSync, h, keyDown, only, program, renderToString, setUrlResolver, withCmds, contents, type Cmd,
  type Sub, type VElement, onRuntimeWarning, type Next,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const host = (): HTMLElement => {
  const d = document.createElement("div");
  document.body.appendChild(d);
  return d;
};

type Counter = { n: number };
const counter = (view: (m: Counter, send: (msg: number) => void) => VElement, cmds: readonly Cmd<number>[] = []) => ({
  init: withCmds<Counter, number>({ n: 1 }, cmds),
  update: (msg: number, m: Counter): Next<Counter, number> => only({ n: m.n + msg }),
  view,
});

const scenarios: Record<string, () => Promise<unknown>> = {
  async attachDisposesItsOwn() {
    let next = 0;
    const stopped: number[] = [];
    const embedded = new Embedded<number, number>(() => {
      const id = ++next;
      return { init: only(id), update: (_m: number, model: number) => only(model), view: () => contents([]), subscriptions: () => [{ key: "life", start: () => () => { stopped.push(id); } }] };
    });
    const a = embedded.attach(host()), b = embedded.attach(host());
    a.dispose();
    const afterFirst = [...stopped];
    b.dispose();
    return { afterFirst, afterBoth: [...stopped] };
  },

  async adoptedRootCleanup() {
    // An Embedded program adopts the element it starts in: a root vnode of the element's tag owns its attributes and
    // listeners, and disposing gives the element back without them.
    let clicks = 0;
    const embedded = new Embedded<number, number>(() => ({
      init: only(0), update: (_m: number, model: number) => only(model),
      view: () => h("div", { class: "owned", onClick: () => { clicks++; } }, ["child"]),
    }));
    const root = host();
    const mount = embedded.attach(root);
    root.click();
    const before = clicks;
    mount.dispose();
    root.click();
    return { before, after: clicks, children: root.childNodes.length, className: root.className };
  },

  async mountTiming() {
    let connected = false, focused = false;
    program(counter(() => h("div", null, [h("input", { onMount: (e) => { connected = e.isConnected; (e as HTMLInputElement).focus(); focused = document.activeElement === e; } }, null)])), host());
    return { connected, focused };
  },

  async mountOnPatch() {
    let mounts = 0;
    const app = program(counter((m) => h("div", null, m.n > 1 ? [h("span", { onMount: () => { mounts++; } }, null)] : [])), host());
    app.send(1);
    app.flush();
    app.send(1);
    app.flush();
    return { mounts };
  },

  async afterCommitOrder() {
    const root = host();
    let early: boolean | null = null, late: boolean | null = null;
    const app = program({
      init: only<{ shown: boolean }, number>({ shown: false }),
      update: (_msg: number, _m: { shown: boolean }) => withCmds<{ shown: boolean }, number>({ shown: true }, [
        () => { early = root.querySelector("p") !== null; },
        afterCommit(() => { late = root.querySelector("p") !== null; }),
      ]),
      view: (m: { shown: boolean }) => h("div", null, m.shown ? [h("p", null, "x")] : []),
    }, root);
    app.send(1);
    await tick();
    return { early, late };
  },

  async microtaskBatching() {
    let views = 0;
    const app = program(counter((m) => { views++; return h("div", null, String(m.n)); }), host());
    const before = views;
    app.send(1);
    app.send(1);
    await Promise.resolve();
    await tick();
    return { before, after: views, model: app.state.n };
  },

  async flushOnlyDirty() {
    let a = 0, b = 0;
    const one = program(counter(() => { a++; return h("div", null, null); }), host());
    program(counter(() => { b++; return h("div", null, null); }), host());
    one.send(1);
    flushSync();
    return { a, b };
  },

  async commandCleanup() {
    let fired = 0, cleaned = 0;
    const app = program(counter(() => h("div", null, null), [(_send, scope) => {
      const id = setTimeout(() => { fired++; }, 10);
      scope.onDispose(() => { clearTimeout(id); cleaned++; });
    }]), host());
    app.dispose();
    await new Promise((r) => setTimeout(r, 30));
    return { fired, cleaned };
  },

  async delayCommand() {
    const seen: string[] = [];
    type M = { last: string };
    const app = program({
      init: withCmds<M, string>({ last: "" }, [delay<string>(1, "a"), delay<string>(2, "b")]),
      update: (msg: string, _m: M) => { seen.push(msg); return only<M, string>({ last: msg }); },
      view: () => h("div", null, null),
    }, host());
    await new Promise((r) => setTimeout(r, 20));
    const scopeSize = (app as unknown as { scope: { pending: number } }).scope.pending;
    return { seen, scopeSize };
  },

  async subscriptionKeyIdentity() {
    let starts = 0;
    const seen: string[] = [];
    const sub = (label: string): Sub<string> => ({ key: "same", start: (send) => { starts++; send(label); return () => {}; } });
    type M = { label: string };
    const app = program({
      init: only<M, string>({ label: "first" }),
      update: (msg: string, m: M) => { seen.push(msg); return only<M, string>(msg === "first" ? { label: "second" } : m); },
      view: () => h("div", null, null),
      subscriptions: (m: M) => [sub(m.label)],
    }, host());
    void app;
    await tick();
    return { starts, seen };
  },

  async subscriptionDuplicateKey() {
    let starts = 0, warned = false;
    onRuntimeWarning(() => { warned = true; });
    const s: Sub<number> = { key: "dup", start: () => { starts++; return () => {}; } };
    program({ ...counter(() => h("div", null, null)), subscriptions: () => [s, s] }, host());
    onRuntimeWarning(null);
    return { starts, warned };
  },

  async keyedFuzz() {
    // A list of keyed rows under random edits: after every patch the DOM order matches the keys, and an element that
    // kept its key (and tag) is the same element.
    let seed = 7;
    const rand = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
    type Row = { id: number; tag: string };
    let rows: Row[] = [];
    for (let i = 0; i < 20; i++) rows.push({ id: i, tag: "li" });
    let nextId = 100;
    const root = host();
    const app = program({
      init: only<Row[], Row[]>(rows),
      update: (msg: Row[], _m: Row[]) => only<Row[], Row[]>(msg),
      view: (m: Row[]) => h("ul", null, m.map((r) => h(r.tag, { "data-id": String(r.id) }, String(r.id), r.id))),
    }, root);
    const failures: string[] = [];
    let steps = 0;
    for (let step = 0; step < 800; step++) {
      const before = new Map<string, Element>();
      for (const el of Array.from(root.querySelectorAll("ul > *"))) before.set(`${el.getAttribute("data-id")}:${el.tagName}`, el);
      const next = rows.slice();
      const op = rand(5);
      if (op === 0 && next.length < 40) next.splice(rand(next.length + 1), 0, { id: nextId++, tag: "li" });
      else if (op === 1 && next.length > 0) next.splice(rand(next.length), 1);
      else if (op === 2 && next.length > 1) { const [r] = next.splice(rand(next.length), 1); next.splice(rand(next.length + 1), 0, r!); }
      else if (op === 3 && next.length > 0) { const at = rand(next.length); next[at] = { id: next[at]!.id, tag: next[at]!.tag === "li" ? "p" : "li" }; }
      else if (next.length > 1) next.reverse();
      rows = next;
      app.send(rows);
      app.flush();
      steps++;
      const els = Array.from(root.querySelectorAll("ul > *"));
      const got = els.map((e) => `${e.getAttribute("data-id")}:${e.tagName}`).join(",");
      const want = rows.map((r) => `${r.id}:${r.tag.toUpperCase()}`).join(",");
      if (got !== want) { failures.push(`step ${step}: ${got} != ${want}`); break; }
      for (const el of els) {
        const key = `${el.getAttribute("data-id")}:${el.tagName}`;
        const was = before.get(key);
        if (was !== undefined && was !== el) { failures.push(`step ${step}: ${key} is a new element`); break; }
      }
      if (failures.length) break;
    }
    return { failures, steps };
  },

  async staticRender() {
    return renderToString(h("div", { class: "a", "aria-label": "x<y" }, [h("img", { src: "/i.png", alt: "" }, null), "a & b", h("i", null, "c"), contents([])]));
  },

  async urlResolver() {
    // A real image the page can load, told apart by its fragment (a URL that failed to load would fire its own error).
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const pending = new Map<string, { resolve: (u: string) => void; reject: () => void }>();
    let errors = 0;
    const root = host();
    const plainApp = program(counter(() => h("img", { src: "/plain.png" }, null)), root);
    const plain = (root.querySelector("img") as HTMLImageElement).getAttribute("src");
    plainApp.dispose();
    setUrlResolver((url) => new Promise<string>((resolve, reject) => { pending.set(url, { resolve, reject: () => reject(new Error("no")) }); }));
    type M = { src: string };
    const app = program({
      init: only<M, string>({ src: "a" }),
      update: (msg: string, _m: M) => only<M, string>({ src: msg }),
      view: (m: M) => h("img", { src: m.src, onError: () => { errors++; } }, null),
    }, root);
    const img = (): HTMLImageElement => root.querySelector("img") as HTMLImageElement;
    const before = img().getAttribute("src");
    pending.get("a")!.resolve(gif + "#a");
    await tick();
    const resolved = img().getAttribute("src")?.slice(gif.length);
    app.send("b");
    app.flush();
    app.send("c");
    app.flush();
    pending.get("c")!.resolve(gif + "#c");
    pending.get("b")!.resolve(gif + "#b");
    await tick();
    const latest = img().getAttribute("src")?.slice(gif.length);
    app.send("d");
    app.flush();
    pending.get("d")!.reject();
    await tick();
    setUrlResolver(null);
    return { plain, before, resolved, latest, errors };
  },
};

export function run(name: string): Promise<unknown> {
  const s = scenarios[name];
  if (s === undefined) throw new Error(`no scenario ${name}`);
  return s();
}
export const names = Object.keys(scenarios);
void keyDown;
