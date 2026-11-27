// @known-defect(engine): engine dyn answers false for prototype data in "k in instance" (not fixed here: the native class bridge was)
// Regression (a9083d09 corpus): `'isVector' in instance` answered false for data on the class prototype (class-prototype-data.js).
import { run } from './w9-class-proto-data-in-helper.js';
console.log(run());
