// Int shadows over + - and comparisons stay exact (overflow, strings, fractions, -0).
import { probe } from "./dyn-int-shadow-arith-helper.js";
const rows: any[] = []; for (let i = 0; i < 9; i++) rows.push({ n: i * 3 - 4 });
console.log(probe(rows));
