import { Editor, createEditor } from "shadowmod";
export function run(): void {
  const e = createEditor("hi");
  console.log(Editor.name(), e.label, e.shout(), typeof createEditor);
}
