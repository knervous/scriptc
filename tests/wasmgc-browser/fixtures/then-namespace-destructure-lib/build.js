// Loaded on demand.
export let calls = 0;
export function C(scene, builds) { calls++; return scene.name + ":" + builds.length; }
export const label = "build";
