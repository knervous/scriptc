function pick(t0: any, k: string) { const { [k]: v, id } = t0; return `${v}:${id}`; }
console.log(pick({ id: 1, a: 2 }, "a"), pick({ id: 3 }, "zz"));
