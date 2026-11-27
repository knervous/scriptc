// @options: {"hostHandles": true, "interfaceClassArms": true}
// A parameter typed `{ hotButton?: boolean } | null` takes records of several wider shapes: ones the program builds as literals (variants) and ones it never builds (they arrive as typed values).
type HotButtonData = { hotButton?: boolean; hotButtonIndex?: number };
type ItemEntry = { slot: number; bagSlot?: number } & HotButtonData;
interface ActionButtonData { type: number; action?: number; label?: string; color?: string; index?: number; data?: string[] }
type ActionData = ActionButtonData & HotButtonData;
const holds = (data: { hotButton?: boolean } | null, shift: boolean): boolean => Boolean(data?.hotButton) && !shift;
function useItem(actionData: ItemEntry | null = null) { return holds(actionData, false); }
function useAction(actionData: ActionData | null = null) { return holds(actionData, false); }
const aList: ActionData[] = [{ type: 1, hotButton: true, label: "x" }, { type: 2, index: 3 }, { type: 3, action: 1, label: "l", color: "c", data: ["d"], index: 2 }, { type: 4, action: 2, label: "m", index: 1 }];
const items: ItemEntry[] = [];
function pick(i: number): ItemEntry | null { return i < items.length ? items[i]! : null; }
console.log(useItem(pick(0)), useItem(pick(5)), useItem(null), items.length);
for (const a of aList) console.log(useAction(a));
console.log(useAction(null));
