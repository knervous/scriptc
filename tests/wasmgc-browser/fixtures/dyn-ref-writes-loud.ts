// @native-any-only: untyped writes through an any-typed binding into compiled class fields
// @native-refuses: a JS-built array is not the typed array; the write is refused, never copied
// @expect-native: loud TypeError
// @expect-native: unchanged true
// @expect-native: loud TypeError
// @expect-native: stored kid1
import { setChildren, setOrtho, mkKids, mkKid } from "./dyn-ref-writes-helper.js";
interface Kid { id: number; describe(): string; hook(done: Promise<Kid[]>): Promise<Kid | undefined> }
class TNode { children: Kid[] = []; ortho: Kid | null = null }
const kid = (id: number): Kid => ({ id, describe() { return "kid" + id; }, async hook() { return undefined; } });
const n = new TNode();
const original = n.children = [kid(1)];
const nc: any = n;
try { setChildren(nc, mkKids()); console.log("stored"); } catch (e) { console.log("loud " + (e as Error).name); }
console.log("unchanged", n.children === original);
try { setOrtho(nc, mkKid()); console.log("stored"); } catch (e) { console.log("loud " + (e as Error).name); }
console.log("stored", n.children[0]!.describe());
