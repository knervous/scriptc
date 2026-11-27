// A keyof type parameter bound to a literal through a chain of generic calls
// (hook<K> -> closure -> on<K> -> channelOf<K>) reads the field statically.
class Channel<T> { readonly items: T[] = []; add(v: T): void { this.items.push(v); } }
interface Events { chat: string; level: number; quiet: undefined; }
type PayloadEvent = { [K in keyof Events]: Events[K] extends undefined ? never : K }[keyof Events];
const channels: { readonly [K in PayloadEvent]: Channel<Events[K]> } = { chat: new Channel<string>(), level: new Channel<number>() };
function channelOf<K extends PayloadEvent>(type: K): Channel<Events[K]> { return channels[type]; }
function on<K extends PayloadEvent>(type: K, value: Events[K]): void { channelOf(type).add(value); }
const effects: Array<() => void> = [];
function useEvent<T extends PayloadEvent>(eventName: T, value: Events[T]): void {
  effects.push(() => { on(eventName, value); });
}
on("chat", "hi");
useEvent("level", 7);
useEvent("chat", "there");
for (const run of effects) run();
console.log(channels.chat.items.join(","), channels.level.items.join(","));
