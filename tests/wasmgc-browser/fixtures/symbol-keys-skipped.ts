// @native-only: the engine dyn model has no compiled symbol keys
// Symbol keys are not string keys: Object.keys, for-in and getOwnPropertySymbols tell them apart.
import { run } from './symbol-keys-skipped-helper.js';
run();
