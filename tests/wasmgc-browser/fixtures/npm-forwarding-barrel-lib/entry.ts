import { renamed, used, wrapped } from "fwdbarrel";
export function run(): void {
  console.log(used(), wrapped(), renamed());
}
