// @options: {"interfaceClassArms": true}
// A spread whose later source is `saved?.hud`: the checker narrows `saved` present inside the conditional,
// but its storage still holds the absent arm, so the earlier spread's defaults must stay in the copy.
type Placement = { x: number; y: number };
type Hud = { chat: Placement; map: Placement };
interface UI { gen?: number; hud: Hud }
type Stored = { ui?: UI };
const defaults: UI = { hud: { chat: { x: 1, y: 2 }, map: { x: 3, y: 4 } } };
function merge(stored: Stored | null): Hud {
  const s: Stored = stored ?? {};
  const savedUi: UI | undefined = s.ui;
  const defaultUi: UI = defaults;
  return savedUi?.gen === 2 ? { ...defaultUi.hud, ...savedUi?.hud } : { ...defaultUi.hud };
}
function show(h: Hud): string { return `${h.chat.x},${h.chat.y}|${h.map.x},${h.map.y}`; }
console.log(show(merge({ ui: { gen: 2, hud: { chat: { x: 9, y: 9 }, map: { x: 8, y: 8 } } } })), show(merge(null)), show(merge({ ui: { hud: { chat: { x: 7, y: 7 }, map: { x: 6, y: 6 } } } })));
