// @options: {"interfaceClassArms": true}
// Writing `undefined` to a field of a union receiver whose arms hold the field at different (undefined-armed) types: the unit literal is stored in each arm directly,
// never through a unit-typed local (the retire-a-packet shape: `packet._owner = undefined; packet._onOwnerEmpty = undefined`).
interface DetachablePacket { _disposed?: boolean; _owner?: DetachablePacket[]; _onOwnerEmpty?: () => void }
interface RenderPacket extends DetachablePacket { id: number; draw: () => string; _owner?: RenderPacket[] }
interface OtherPacket { _disposed?: boolean; _owner?: OtherPacket[]; label: string }
const registry = new Map<() => void, DetachablePacket>();
function retire(dispose: () => void, log: string[]): void {
  const packet = registry.get(dispose);
  if (packet) {
    packet._disposed = true;
    const owner = packet._owner;
    if (owner) {
      const index = owner.indexOf(packet);
      if (index >= 0) owner.splice(index, 1);
      packet._owner = undefined;
      if (owner.length === 0) {
        packet._onOwnerEmpty?.();
      }
      if (packet._onOwnerEmpty) packet._onOwnerEmpty = undefined;
    }
    log.push("retired" + (packet._disposed ? "!" : "?"));
  }
}
const list: RenderPacket[] = [];
const o2: OtherPacket = { label: 'x' }; const regOther: DetachablePacket = o2; registry.set(() => {}, regOther);
const p1: RenderPacket = { id: 1, draw: () => "p1", _owner: list, _onOwnerEmpty: () => console.log("empty") };
list.push(p1);
const d1 = () => {};
registry.set(d1, p1);
const log: string[] = [];
retire(d1, log);
console.log(log.join(","), p1._owner === undefined, p1._onOwnerEmpty === undefined, p1._disposed);
