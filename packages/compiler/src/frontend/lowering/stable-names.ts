// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { createHash } from "node:crypto";
import { InternalCompilerError } from "../../errors.js";

/** The owner of the names keyedHelperName hands out. */
export interface KeyedNameOwner {
  /** Each keyed name with a second hash of the key it was made from, which
   * tells a repeated key from a different key with the same name. */
  readonly keyedNameKeys: Map<string, number>;
}

/** 48 bits of two FNV-1a hashes of `key`, as 12 hex digits. */
export function keyHash(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  const high = (b >>> 0).toString(16).padStart(8, "0").slice(4);
  return high + (a >>> 0).toString(16).padStart(8, "0");
}

/** A 32-bit hash of `key` independent of keyHash's bits. */
function checkHash(key: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 0x85ebca6b) ^ (h >>> 15);
  return h >>> 0;
}

/** The name of a helper interned by `key`: `<prefix><separator><hash of
 * key>`. It depends only on the key, not on how many helpers were interned
 * before, so a helper has the same name whichever unit first needs it. Two
 * keys that hash to the same name throw an InternalCompilerError. */
export function keyedHelperName(
  owner: KeyedNameOwner,
  prefix: string,
  rawKey: string,
  separator = ".",
): string {
  const key = stableFileName(rawKey);
  const name = `${prefix}${separator}${keyHash(`${prefix}|${key}`)}`;
  const check = checkHash(`${prefix}|${key}`);
  const previous = owner.keyedNameKeys.get(name);
  if (previous === undefined) owner.keyedNameKeys.set(name, check);
  else if (previous !== check)
    throw new InternalCompilerError(`helper name ${name} is shared by two helper keys`);
  return name;
}

/** A checked id for a registry entry interned by `key`: `<prefix><hash of key>`, the same id whichever order the program
 * reaches the entry in. `owners` maps each id to a second hash of its key; two keys sharing an id throw. */
export function keyedId(owners: Map<string, number>, prefix: string, rawKey: string): string {
  const key = stableFileName(rawKey);
  const id = `${prefix}${keyHash(`${prefix}|${key}`)}`;
  const check = checkHash(key);
  const previous = owners.get(id);
  if (previous === undefined) owners.set(id, check);
  else if (previous !== check) throw new InternalCompilerError(`registry id ${id} is shared by two keys`);
  return id;
}

/** The compiler package's own directory (its ambient declarations live there), as `<scriptc>/` in a key. */
const COMPILER_DIR = (() => {
  try {
    const url = new URL("../../../", import.meta.url);
    return url.protocol === "file:" ? decodeURIComponent(url.pathname) : "";
  } catch {
    return "";
  }
})();

/** The directory the program's own sources share (the checkout), dropped from keys: see setStableNameFiles. */
let checkoutPrefix = "";

const withoutMirror = (file: string): string => file.replace(/\.wasmgc-[A-Za-z0-9_-]*/g, ".wasmgc");

/**
 * Sets the checkout a program's keys are relative to: the longest directory the program's own sources share, with
 * packages (anything under node_modules/) and the compiler's ambient files left out. A key then names a file the same
 * way in every checkout of the same tree, so the names and ids made from it -- and the orders that follow them (a
 * union's arms are kept in the order of their keys) -- do not depend on where the tree lives.
 */
export function setStableNameFiles(files: readonly string[]): void {
  const own = files.map(withoutMirror).filter((f) => f.startsWith("/") && !f.includes("/node_modules/") && !(COMPILER_DIR && f.startsWith(COMPILER_DIR)));
  if (own.length === 0) { checkoutPrefix = ""; return; }
  let prefix = own[0]!.slice(0, own[0]!.lastIndexOf("/") + 1);
  for (const f of own) while (prefix && !f.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
  checkoutPrefix = prefix.length > 1 ? prefix : "";
}

/** Separate compilation: keys are relative to the object root, whatever files one object's program holds, so every
 * object names a keyed helper alike. */
export function setStableNameRoot(root: string): void {
  checkoutPrefix = root.endsWith("/") ? root : `${root}/`;
}

/**
 * A key's paths as they read in any checkout: without the private mirror directory a build compiles from
 * (`.wasmgc-entry<pid>`), with the compiler's own files as `<scriptc>/`, a package's as `node_modules/<package path>`,
 * and the program's own relative to the checkout (setStableNameFiles), so names derived from it agree between builds
 * and between checkouts.
 */
export function stableFileName(file: string): string {
  let key = withoutMirror(file);
  if (COMPILER_DIR) key = key.split(COMPILER_DIR).join("<scriptc>/");
  key = key.replace(/(?:\/[^/|\s"'`:]+)*\/node_modules\//g, "node_modules/");
  if (checkoutPrefix) key = key.split(checkoutPrefix).join("");
  return key;
}

/** A module namespace's opaque runtime id under stripSourceSites (`m:<hash>`): the hash of its `file:` id as it reads
 * in any checkout (stableFileName), so a build is reproducible whatever private mirror (`.wasmgc-entry<pid>`) or
 * checkout it compiled from. The type mapper's text and the emitter's runtime id both take it. */
export function opaqueModuleId(id: string): string {
  return `m:${createHash("sha256").update(stableFileName(id)).digest("hex").slice(0, 12)}`;
}
