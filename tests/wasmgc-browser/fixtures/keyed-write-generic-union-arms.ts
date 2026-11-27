// @options: {"interfaceClassArms": true}
// A keyed write through a generic keyof parameter (ui[key] = value) on an interface slot holding record arms
// that store a field at different types: with the key bound to a literal it is a plain field store on each arm.
interface Tab { name: string; kinds: string[] }
interface UI { chatTabs: Tab[]; scale: number; gen?: number; locked?: boolean; panel: "auto" | "on" | "off" }
type Config = { name: string; ui: UI };
const DEFAULT_CONFIG: Config = {
  name: "default",
  ui: { chatTabs: [{ name: "Main", kinds: ["all"] }], scale: 1, panel: "auto" },
};
const GEN = 7;
function merge(saved: UI | undefined): Config {
  const base: UI = saved ?? DEFAULT_CONFIG.ui;
  return {
    name: "merged",
    ui: { ...base, chatTabs: [{ name: "S", kinds: [] }], gen: GEN, locked: saved ? false : true },
  };
}
interface WideUI extends UI { extra: number }
class Store {
  private config: Config = DEFAULT_CONFIG;
  load(saved: UI | undefined): void { this.config = merge(saved); }
  updateUISetting<K extends keyof UI>(key: K, value: UI[K]) {
    this.config.ui[key] = value;
  }
  adopt(w: WideUI): void { this.config.ui = w; }
  show(): string {
    const u = this.config.ui;
    return `${this.config.name} ${u.chatTabs.length > 0 ? u.chatTabs[0].name : '-'} ${u.scale} ${u.gen} ${u.locked} ${u.panel}`;
  }
}
const s = new Store();
s.updateUISetting("chatTabs", [{ name: "x", kinds: ["y"] }]);
s.updateUISetting("scale", 2);
s.updateUISetting("gen", 3);
console.log(s.show());
s.load(undefined);
s.updateUISetting("panel", "on");
s.updateUISetting("locked", false);
s.updateUISetting("gen", 9);
s.updateUISetting("scale", 6);
console.log(s.show());
s.load({ chatTabs: [{ name: "L", kinds: ["k"] }], scale: 8, panel: "off" });
s.updateUISetting("gen", 1);
console.log(s.show(), DEFAULT_CONFIG.ui.scale, DEFAULT_CONFIG.ui.gen);
const wide: WideUI = { chatTabs: [{ name: "W", kinds: [] }], scale: 11, panel: "on", extra: 5, gen: 2 };
s.adopt(wide);
s.updateUISetting("scale", 12);
s.updateUISetting("locked", true);
s.updateUISetting("chatTabs", []);
console.log(s.show(), wide.scale, wide.locked, wide.extra, wide.chatTabs.length);
