// `{ ...settings, ...patch }` with `patch: Partial<Settings>`: a later spread's OPTIONAL field defines nothing when
// unset, so the earlier contributor's value stays. The literal treated every field of a later record spread as
// overriding, skipped the earlier copy, and then narrowed the unset optional into the required slot: "undefined is
// not representable in the target union" (the client's UserConfig.updateUISettings, closing the tips guide).
type Layout = Record<string, { x: number; y: number }>;
interface UISettings { showTips: boolean; tipsSeen: string[]; scale: number | "auto"; hudWindows: Layout; theme?: string }
class Config {
  config: { ui: UISettings } = { ui: { showTips: true, tipsSeen: [], scale: "auto", hudWindows: { chat: { x: 1, y: 2 } } } };
  updateUISettings(patch: Partial<UISettings>): void {
    this.config.ui = { ...this.config.ui, ...patch };
  }
}
const c = new Config();
const writeTipsSeen = (value: string[]) => c.updateUISettings({ tipsSeen: value });
const writeShowTips = (value: boolean) => c.updateUISettings({ showTips: value });
writeTipsSeen(["welcome"]);
writeShowTips(false);
c.updateUISettings({ theme: "dark" });
const ui = c.config.ui;
console.log(ui.showTips, ui.tipsSeen.join(","), ui.scale, ui.hudWindows.chat.x, ui.theme, Object.keys(ui).join(","));
interface A { showTips: boolean; other: number }
const a: A = { showTips: true, other: 1 };
const updA = (patch: Partial<A>): A => ({ ...a, ...patch });
console.log("A", JSON.stringify(updA({ other: 2 })), JSON.stringify(updA({ showTips: false })), JSON.stringify(updA({})));
interface B { tipsSeen: string[]; scale: number | "auto"; hud: Record<string, { x: number }>; label?: string }
const b: B = { tipsSeen: ["x"], scale: "auto", hud: { k: { x: 1 } } };
const updB = (patch: Partial<B>): B => ({ ...b, ...patch });
for (const p of [{ scale: 2 }, { tipsSeen: [] }, { hud: {} }, { label: "l" }] as Partial<B>[]) console.log("B", JSON.stringify(updB(p)));
// A required field in the later spread still overrides unconditionally.
interface Full { showTips: boolean; other: number }
const full: Full = { showTips: false, other: 9 };
console.log("full", JSON.stringify({ ...a, ...full }));
