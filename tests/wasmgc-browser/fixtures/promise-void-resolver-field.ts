// The resolver of a Promise<void> stored in a () => void field, called later.
class Registry {
  private sceneRegistered!: () => void;
  private readonly mainRegistered = new Promise<void>((resolve) => (this.sceneRegistered = resolve));
  async ready(): Promise<void> {
    this.sceneRegistered();
    await this.mainRegistered;
    console.log("registered");
  }
  waitFor(): Promise<void> { return this.mainRegistered; }
}
const r = new Registry();
void r.ready().then(() => r.waitFor()).then(() => console.log("again"));
