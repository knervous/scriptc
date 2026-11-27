// Regression (formerly a known defect): a symbol read back from an untyped array literal (a union with a symbol arm) keys a computed property as that symbol.
import { symbolKey } from './defect-dyn-symbol-computed-key-helper.js';
console.log(symbolKey());
