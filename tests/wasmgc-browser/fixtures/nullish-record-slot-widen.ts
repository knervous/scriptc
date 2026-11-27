// ?? whose present arm is a record carrying a slot for an optional field of a wider type, against a default and
// a result of the narrower declared record: the present arm converts after the nullish test.
interface Settings { music: boolean; volume: number; mode: string }
interface StoredSettings extends Settings { quality?: string }
interface Stored { settings?: StoredSettings; name?: string }
const DEFAULTS: Settings = { music: true, volume: 5, mode: "a" };
function read(text: string): Stored | null { return text ? (JSON.parse(text) as Stored) : null; }
function merge(configData: Stored | null): Settings {
  const stored: Stored = configData ?? {};
  const settingsStored: Settings = stored.settings ?? DEFAULTS;
  const settingsBase: Settings = { ...DEFAULTS, ...settingsStored };
  return { ...settingsBase, volume: stored.settings?.quality === "hi" ? 9 : settingsBase.volume };
}
const a = merge(read('{"settings":{"music":false,"volume":1,"mode":"b","quality":"hi"}}'));
const b = merge(read(""));
console.log(a.music, a.volume, a.mode, b.music, b.volume, b.mode);
