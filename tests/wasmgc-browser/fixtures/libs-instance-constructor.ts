// @native-only: reading a class value through an instance's constructor needs classval, which engine dyn lacks
import { run } from "./libs-instance-constructor-helper.js";
console.log(run());
