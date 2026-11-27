// @native-only: the engine dyn model has no compiled symbols (Symbol() is sym.new)
// Symbol keys and string keys that look like their reserved names (host.ts symbolKey, dyn-object.ts KEY_MARK):
// two symbols sharing a description, strings spelling every plausible encoded name exactly, prefix lookalikes
// (a lone U+DFFF, digits, junk) and an already-escaped-looking string all coexist on one object, with
// independent reads, writes, deletes and enumeration.
import { run } from "./dyn-symbol-key-lookalikes-helper.js";
run();
