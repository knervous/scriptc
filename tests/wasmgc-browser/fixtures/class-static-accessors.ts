// Static getters: a lazy singleton, a getter over a static field, and one
// inherited through a subclass's name.
class Config {
  private static instance_: Config | null = null;
  private static count = 0;
  readonly id: number;
  constructor() {
    Config.count = Config.count + 1;
    this.id = Config.count;
  }
  static get instance(): Config {
    if (!Config.instance_) Config.instance_ = new Config();
    return Config.instance_;
  }
  static get made(): number {
    return Config.count;
  }
}
class Child extends Config {}

console.log(Config.made);
console.log(Config.instance.id, Config.instance.id, Config.instance === Config.instance);
console.log(Config.made, Child.made);
new Child();
console.log(Child.made);
