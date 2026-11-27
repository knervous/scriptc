// `void device?.lost?.then(cb)`: an optional chain over a promise, the callback returning void.
interface LostInfo { reason: string; message: string; }
interface Device { lost?: Promise<LostInfo>; }
class World {
  private lostReason: Promise<string> | null = null;
  private disposed = false;
  private readonly device: Device | undefined;
  constructor(device: Device | undefined) { this.device = device; }
  get lost(): Promise<string> {
    if (!this.lostReason) {
      const device = this.device;
      this.lostReason = new Promise<string>((resolve) => {
        void device?.lost?.then((info) => {
          if (this.disposed) return;
          resolve(`device lost (${info.reason || "unknown"}): ${info.message || "no message"}`);
        });
      });
    }
    return this.lostReason;
  }
}
const w = new World({ lost: Promise.resolve({ reason: "destroyed", message: "bye" }) });
void w.lost.then((m) => console.log(m));
const none = new World(undefined);
void none.lost;
console.log("pending");
