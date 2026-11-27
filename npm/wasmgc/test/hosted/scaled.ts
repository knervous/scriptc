/// <reference path="./host-math.d.ts" />
// A program importing a typed host module, built with --browser and run under Node through `scriptw/host`.
import { later, name, scale } from "host:math";

const values = [1, 2, 3].map(scale);
console.log(name(), values.join(" "));
console.log("later", await later(20));
