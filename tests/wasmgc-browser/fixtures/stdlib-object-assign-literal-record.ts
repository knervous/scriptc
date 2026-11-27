// @options: {"interfaceClassArms": true}
interface LineMat { useVertexColor?: boolean; color?: number[]; _topology?: string }
const material = {} as LineMat;
const useVertexColor = true, color = [1, 2, 3];
Object.assign(material, { useVertexColor, color, _topology: "line-list" });
console.log(JSON.stringify(material));
