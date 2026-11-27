interface S { a: boolean; b: boolean; c: boolean }
class P {
  setSetting(key: keyof S, value: boolean): Partial<S> {
    const settings: Partial<S> = { [key]: value };
    return settings;
  }
}
console.log(JSON.stringify(new P().setSetting("c", true)), JSON.stringify(new P().setSetting("a", false)));
