// @options: {"interfaceClassArms": true}
interface Data { _worldMatrix: number[]; _nodeIndex: number; _material: string; extra: number }
const meshData: Data = { _worldMatrix: [1], _nodeIndex: 2, _material: "m", extra: 0 };
const source: Data = { _worldMatrix: [9], _nodeIndex: 8, _material: "s", extra: 7 };
Object.assign(meshData, source);
console.log(JSON.stringify(meshData));
