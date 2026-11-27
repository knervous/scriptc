// A type that is also the base of an intersection arm of a discriminated union (`{ kind } & FootstepEvent`) maps itself while its interface arms
// resolve (the intersection flows into a `FootstepEvent` parameter). With nothing else flowing in, its arms close with ONE arm: a single-arm union is
// never a type - the type stays its record and the references minted meanwhile are that record.
interface FootstepEvent { actorId: string | number; weight: number; foot: "left" | "right"; position?: { x: number; y: number } }
interface SwingEvent { actorId: string | number; reach: number }
type SoundEvent =
  | { kind: "ui"; id: string }
  | ({ kind: "footstep"; isPlayer: boolean } & FootstepEvent)
  | ({ kind: "swing"; isPlayer: boolean } & SwingEvent);
function resolveFoot(e: FootstepEvent, isPlayer: boolean): string {
  return e.actorId + e.foot + e.weight + (e.position ? e.position.x : "-") + isPlayer;
}
function resolveSwing(e: SwingEvent, isPlayer: boolean): string { return e.actorId + ":" + e.reach + isPlayer; }
function handle(ev: SoundEvent): string {
  switch (ev.kind) {
    case "ui": return "ui:" + ev.id;
    case "footstep": return resolveFoot(ev, ev.isPlayer);
    case "swing": return resolveSwing(ev, ev.isPlayer);
  }
}
const events: SoundEvent[] = [
  { kind: "ui", id: "click" },
  { kind: "footstep", isPlayer: true, actorId: "a", weight: 0.5, foot: "left", position: { x: 1, y: 2 } },
  { kind: "swing", isPlayer: false, actorId: 7, reach: 2 },
  { kind: "footstep", isPlayer: false, actorId: 8, weight: 1, foot: "right" },
];
console.log(events.map(handle).join("|"));

// The same type in nullable fields and union writes (the ICE classes the single-arm union caused downstream): writing undefined into a
// field, narrowing it, and returning it inside a record beside an array union.
interface Holder { owner: FootstepEvent | undefined; onEmpty: (() => void) | undefined; shared: Float32Array | Uint16Array | undefined }
const holder: Holder = { owner: { actorId: 1, weight: 2, foot: "left" }, onEmpty: () => console.log("empty"), shared: new Uint16Array([1, 2, 3]) };
function describe(h: Holder, count: number): { typed: Uint16Array | null; shared: Float32Array | Uint16Array | null; count: number; owner: string } {
  const indices = h.shared instanceof Uint16Array ? h.shared : undefined;
  return { typed: indices !== undefined ? indices.slice(0, count) : null, shared: h.shared ?? null, count, owner: h.owner ? h.owner.foot : "none" };
}
const before = describe(holder, 2);
console.log(before.typed?.length, before.shared === null, before.count, before.owner);
holder.owner = undefined;
holder.shared = undefined;
if (holder.onEmpty) holder.onEmpty();
holder.onEmpty = undefined;
const after = describe(holder, 2);
console.log(after.typed === null, after.shared === null, after.owner, holder.onEmpty === undefined);
