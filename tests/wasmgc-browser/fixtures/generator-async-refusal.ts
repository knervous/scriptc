// @refuse: async function
async function* agen(): AsyncGenerator<number, void, undefined> { yield 1; yield 2; }
async function main() { for await (const v of agen()) console.log(v); }
main();
