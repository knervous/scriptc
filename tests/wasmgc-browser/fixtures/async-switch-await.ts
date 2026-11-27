async function pick(n: number): Promise<number> { return n * 10; }
async function run(k: number): Promise<string> {
  let out = "";
  switch (k) {
    case 0:
      out += "a" + (await pick(1));
      break;
    case 1:
      out += "b" + (await pick(2));
    case 2:
      out += "c" + (await pick(3));
      break;
    case 3: {
      const v = await pick(4);
      out += "d" + v;
    }
    default:
      out += "z" + (await pick(5));
  }
  return out;
}
async function main() {
  for (let k = 0; k < 6; k++) console.log(k, await run(k));
}
main();
