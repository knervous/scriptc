// @options: {"hostHandles": true}
// @native-any-only: `any` is a checked dyn value only in the native-any lane
// A React.FC-shaped arrow with many destructured props (defaults, string-literal unions, nested records, callbacks, page values) is callable from untyped code.
type WindowId = "inventory" | "spells" | "map";
type Placement = { x: number; y: number; w?: number; pinned?: boolean };
interface Props {
  id: WindowId;
  title?: string;
  placement?: Placement;
  bottomInset?: number;
  maxWidth?: number;
  className?: string;
  tabs?: ReadonlyArray<{ key: string; label: string }>;
  mode?: "compact" | "wide" | null;
  onChange?: (id: WindowId, placement: Placement) => void;
  onFocus?: (id: WindowId) => void;
  onClose?: (e: MouseEvent) => void;
  anchor?: HTMLElement | null;
  children?: unknown;
}
const events: string[] = [];
const HudWindow = ({ id, title = "Untitled", placement, bottomInset = 0, maxWidth = Number.POSITIVE_INFINITY, className = "", tabs, mode, onChange, onFocus, onClose, anchor, children }: Props): string => {
  onFocus?.(id);
  if (placement !== undefined) onChange?.(id, { x: placement.x + 1, y: placement.y, pinned: placement.pinned });
  return [id, title, placement === undefined ? "-" : placement.x + ":" + placement.y, bottomInset, maxWidth, className === "" ? "_" : className, tabs === undefined ? "-" : tabs.map((t) => t.label).join("+"),
    mode === undefined ? "u" : mode === null ? "n" : mode, onClose === undefined ? "-" : "c", anchor === undefined ? "-" : anchor === null ? "n" : "a", children === undefined ? "-" : "k"].join("|");
};
function createElement(type: any, props: any, kid?: any): string { return type(kid === undefined ? props : { ...props, children: kid }); }
function isCallable(f: any): string { return typeof f === "function" ? "function" : typeof f; }
const out: string[] = [isCallable(HudWindow)];
out.push(createElement(HudWindow, { id: "map" }));
out.push(createElement(HudWindow, { id: "inventory", title: "Bag", placement: { x: 4, y: 5, pinned: true }, bottomInset: 12, maxWidth: 300, className: "w", tabs: [{ key: "a", label: "A" }, { key: "b", label: "B" }], mode: "wide",
  onChange: (id: WindowId, p: Placement) => events.push("change " + id + " " + p.x + "," + p.y + "," + String(p.pinned)), onFocus: (id: WindowId) => events.push("focus " + id), onClose: () => {}, anchor: null }, "child"));
out.push(createElement(HudWindow, { id: "spells", mode: null, anchor: undefined, onFocus: undefined }));
console.log(out.join("\n") + "\n" + events.join(";"));
