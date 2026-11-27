/* The DOM mirror (experimentalDomMirror, off by default).
 *
 * A DOM node compiled code creates through a document's own createElement
 * (one argument), createTextNode or createComment is held in Wasm as a
 * `$page.node` struct: the node's externref plus what Wasm knows about it.
 * The page keeps seeing the node itself. The host stamps the node with its
 * struct (a private field, invisible to page JavaScript), and every way a
 * page value enters compiled code (js.toDyn, js.classify / js.unwrapAny)
 * turns a stamped node into its struct, so compiled code only ever holds
 * the struct: `===`, Map/Set keys and identity hashing are exact by
 * reference, with no host call. Leaving Wasm ($dyn.toJs and every page
 * branch of the generic operations) a struct becomes its node again.
 *
 * What the struct knows:
 * - nodeType (fixed for a node's life).
 * - ownerDocument: the creating document, re-read from the host once per
 *   epoch afterwards.
 * - Structure, valid only while the global epoch equals the struct's epoch:
 *   its parent and, for a node whose child list Wasm has seen from empty, its
 *   first/last child and each child's siblings. A fresh node knows it has no
 *   parent and no children.
 * - Whether its whole subtree is inert: every node in it is one of ours,
 *   created as a text/comment node or an element whose tag can run no page
 *   code when it is inserted, removed or given attributes (anything but
 *   script, iframe, frame, object, embed, portal and names with a dash,
 *   which may be custom elements).
 *
 * The epoch (`$dom.epoch`) changes whenever page JavaScript may have run:
 * - before every host import that is not known to be free of page code
 *   (dom-mirror PAGE_CODE_FREE, plus the mirror's own operations, which
 *   decide for themselves);
 * - at the entry and the exit (return or throw) of every exported function
 *   (JavaScript calling compiled code means page code ran before, and may
 *   run after, while compiled code that called out to the page resumes).
 * So no structure fact outlives a stretch of page code. A mirrored read
 * whose fact is stale asks the host as before (and ownerDocument caches
 * the answer for the new epoch).
 *
 * Mutations through the DOM's own methods on mirrored nodes keep the epoch
 * when they provably run no page code: appending or inserting a fresh,
 * parentless node whose subtree is inert (no custom element reaction, no
 * script, no frame load), setting attributes, textContent, nodeValue,
 * className or an event handler property of an inert node to a primitive
 * (or a compiled function for a handler). The host checks that the method
 * it calls is the DOM's own (`p.appendChild === Node.prototype.appendChild`)
 * and otherwise makes the generic call, and the epoch changes.
 *
 * Expandos: on a mirrored node, a string key that no DOM interface of the
 * page's realm defines (React's `__reactFiber$…` and `__reactProps$…`) is
 * the module's own: compiled stores, reads, `in`, hasOwnProperty and
 * deletes of it use the struct's native object (null prototype) and never
 * touch the node. So page code does not see compiled expandos, and compiled
 * code does not see properties of such keys that page code puts on the node
 * (opt-in: CHANGES WHAT PAGE JAVASCRIPT OBSERVES). Enumeration (for-in,
 * Object.keys) and descriptors of a mirrored node are the node's.
 *
 * Assumptions (why the option is opt-in): the DOM's own accessors for the
 * mirrored members (nodeType, ownerDocument, parentNode, firstChild,
 * lastChild, nextSibling, previousSibling, textContent, nodeValue,
 * className, on*) are not replaced on mirrored nodes or their prototypes,
 * no legacy mutation event (DOMNodeInserted, …) listener observes them, and
 * the DOM interface member names are those of the realm when the first
 * node is mirrored.
 */

/** Host imports that never run page code: no getter, setter, Proxy trap,
 * toString/valueOf or callback can be reached through them, so they keep
 * the mirror's epoch (an `@d<n>` twin counts as its base name). */
export const PAGE_CODE_FREE: ReadonlySet<string> = new Set([
  "js.eq", "js.neq", "js.classify", "js.unwrapAny", "js.unwrapFacade", "js.toNum", "js.toBool", "js.fromNum", "js.fromBool", "js.null",
  "js.undefined", "js.arrayIterPristine", "js.iterPristine", "js.arrayMemberPristine", "js.fromDynFn", "js.dynFacade", "js.dynFacadeCached", "js.symFor", "js.symWellKnown",
  "js.is.string", "js.is.number", "js.is.boolean", "js.is.undefined", "js.is.nullish", "js.is.array", "js.is.object", "js.is.function",
  "js.is.symbol", "js.is.bigint", "js.typeof", "js.isNullish", "num.toString", "num.toStringRadix", "math.random", "obj.id",
  "js.deferred", "js.deferredPromise", "js.promisePage", "js.keepPromisePage",
]);
export const pageCodeFree = (name: string): boolean => PAGE_CODE_FREE.has(name.replace(/@d\d+$/, "")) || name.startsWith("js.domm.");

/** `$page.node` fields. */
export const PN_EXT = 0, PN_TYPE = 1, PN_FLAGS = 2, PN_EPOCH = 3, PN_PARENT = 4, PN_FIRST = 5, PN_LAST = 6, PN_NEXT = 7, PN_PREV = 8,
  PN_DOC = 9, PN_DOC_EPOCH = 10, PN_DOC_ID = 11, PN_PROPS = 12, PN_NPROPS = 13;
/** PN_FLAGS bits. INERT is fixed; the others hold while PN_EPOCH is current. */
export const PNF_INERT = 1, PNF_SUBTREE_INERT = 2, PNF_KNOWN_CHILDREN = 4, PNF_KNOWN_PARENT = 8;

/** Elements whose insertion, removal or attribute changes can run page code
 * synchronously (scripts, frames, plugins); a tag with a dash may be a
 * custom element. Everything else, text and comments are inert. */
export const UNSAFE_TAGS: ReadonlySet<string> = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "portal", "fencedframe", "applet"]);
export const inertTag = (tag: unknown): boolean => typeof tag === "string" && !tag.includes("-") && !UNSAFE_TAGS.has(tag.toLowerCase());

/** DOM members the mirror answers or mutates in Wasm (constant-key reads). */
export const MIRROR_READS: ReadonlySet<string> = new Set(["nodeType", "ownerDocument", "parentNode", "firstChild", "lastChild", "nextSibling", "previousSibling"]);
