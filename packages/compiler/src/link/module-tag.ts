/* Separate compilation's module identity (docs-draft/OBJECT_FILES_POC.md). An object names every symbol of a module by
 * that module's tag, and the tag depends only on the module's path relative to the object root: two objects that both
 * see a module agree on the names of its functions, classes and globals without either seeing the other. */
import { relative } from "node:path";

/** A separately compiled object unit: `root` is the directory module paths are relative to; `module` the file the object
 * owns. Without `module` the entry is the unit (its program is its own import closure); with it, the entry is the
 * program root, so every object of one program sees the same modules and its whole-program analyses (interface class
 * arms) answer the same for each (ThinLTO's combined view, here the whole program each object lowers against). */
/** The fence code of a header-mode placeholder body (Lowerer.headerStub): a body another module's object defines. It is
 * not a proven-unreachable trap (SC9002/SC9003, which a release admits): the linker refuses one that reaches a link. */
export const HEADER_PLACEHOLDER_CODE = "SC9004";

export interface ObjectUnit {
  root: string;
  module?: string;
  /** "program": one lowering of the whole program (no headers, every module's initializers), partitioned into every
   * module's object (compileProgramObjects). Default "module": the lowering owns `module` only. */
  mode?: "module" | "program";
  /** Module mode, recompiling against a seed: the units the module's seeded object defined (the ones its program
   * reached), lowered as roots in place of every unit of the module; and the deferred initializers the seed left
   * deferred, which the module need not materialize unless its own code now reads them. */
  roots?: readonly string[];
  deferred?: readonly string[];
  /** The units the seed's lowering knew in the module (reached or not): any other unit is new, and a root. */
  knownUnits?: readonly string[];
  /** The classes whose layout in the seed carries a property bag (some untyped code in the program writes their
   * expandos): a whole-program layout decision this lowering cannot see from its own module's code. */
  seedBagClasses?: readonly string[];
}

/** A module's path as objects name it: relative to the root, with forward slashes. */
export function objectModulePath(unit: ObjectUnit, fileName: string): string {
  return relative(unit.root, fileName).split("\\").join("/");
}

/** The module's FNV-1a hash, in decimal: the tag reads as an ordinary module tag (`%m<digits>.`) where the emitter and
 * the diagnostics expect one. */
export function objectModuleHash(unit: ObjectUnit, fileName: string): string {
  const path = objectModulePath(unit, fileName);
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193);
  return String(h >>> 0);
}

/** An object unit's tag for a file (`%m<hash>.`; `%t<hash>.` for a type-only class file). */
export function objectModuleTag(unit: ObjectUnit, fileName: string, prefix = "%m"): string {
  return `${prefix}${objectModuleHash(unit, fileName)}.`;
}
