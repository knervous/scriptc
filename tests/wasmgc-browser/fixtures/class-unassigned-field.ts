class Gauge { level: number; constructor(level: number) { this.level = level; } }
class Panel {
  gauge: Gauge;
  ready: boolean;
  constructor() {
    this.ready = Panel.inspect(this);
    this.gauge = new Gauge(3);
  }
  static inspect(p: Panel): boolean {
    console.log("present:", typeof p.gauge, p.gauge);
    return p.gauge === undefined;
  }
}
const panel = new Panel();
console.log(panel.ready, panel.gauge.level);
class Widget {
  name: string;
  constructor(name: string) { this.name = name; this.describe(); }
  describe(): void { console.log("widget", this.name); }
}
class Slider extends Widget {
  track: Gauge;
  constructor() { super("slider"); this.track = new Gauge(7); this.describe(); }
  override describe(): void {
    if (this.track) console.log("track", this.track.level);
    else console.log("missing", this.track === undefined, this.track == null);
    try { console.log(this.track.level); } catch (e) { console.log("caught", (e as Error).name); }
  }
}
console.log(new Slider().track.level);
