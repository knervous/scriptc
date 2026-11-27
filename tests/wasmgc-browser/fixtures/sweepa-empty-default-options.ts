// @options: {"interfaceClassArms": true}
// An options interface whose only literal is the empty default (`= {}`) while a wider record also
// flows in: the empty literal builds the options record itself.
interface LayerOptions { color?: string; depthTest?: boolean; worldScale?: number }
interface StyledLayer extends LayerOptions { color: string; depthTest: boolean; worldScale: number; id: number }
function layerOf(options: LayerOptions = {}): string {
  return `${options.color ?? "none"}/${options.depthTest ?? "-"}/${options.worldScale ?? "-"}`;
}
const styled: StyledLayer = { color: "red", depthTest: true, worldScale: 2, id: 1 };
console.log(layerOf(), layerOf(styled));
styled.color = "green";
console.log(layerOf(styled));
