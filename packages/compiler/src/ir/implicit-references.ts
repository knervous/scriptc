/** Names an IR node reaches by backend convention rather than by holding them: a `new` reaches its class's constructor;
 * a `classRef` (a class used as a value) reaches its constructor and static data, and the packed construction helper
 * `new` through any class value runs (emitter.ts reachability). Everything that walks references must follow these as well as the names a node holds:
 * the backend's reachability and the object partitioner (link/object.ts), whose closure would otherwise drop the
 * helper from every object (the joined program then threw on dynamic construction). */
export interface ImplicitReference {
  name: string;
  /** "member": a unit of the named class (a dynamic-dispatch arm may name every class, so the backend treats it as a
   * soft reference there). "helper": a shared helper (a COMDAT), always reached. */
  scope: "member" | "helper";
}

/** The packed class-construction helper (frontend/lowering/class-construction.ts). */
export const CLASS_CONSTRUCT_PACKED = "%class.construct:packed";

export function implicitReferences(node: { kind?: unknown; className?: unknown }): readonly ImplicitReference[] {
  // `new C(...)` runs C's constructor unit, which the node names only by its class.
  if (node.kind === "new" && typeof node.className === "string") return [{ name: `%${node.className}.constructor`, scope: "member" }];
  if (node.kind === "classRef" && typeof node.className === "string") {
    return [
      { name: `%${node.className}.constructor`, scope: "member" },
      { name: `%static.data.${node.className}`, scope: "member" },
      { name: CLASS_CONSTRUCT_PACKED, scope: "helper" },
    ];
  }
  return [];
}

/** Functions the backend roots by convention, with no IR node naming them: the class bridge's helpers, and (native
 * host builds) the built-in constructor values an inherited `constructor` answers (emitter.ts reachability). The
 * object linker's program artifact carries every one the lowering produced, so a link reaches them as a whole program
 * does. */
export function backendRoots(opts: { hostHandles?: boolean }): readonly string[] {
  return [
    "%dyn.class.properties", "%dyn.class.fieldCreated",
    ...(opts.hostHandles ? HOST_CONSTRUCTOR_VALUES.map((name) => `%builtin.${name}.ctorValue`) : []),
  ];
}

/** The built-in constructors whose compiled values a native host build keeps (backendRoots). */
export const HOST_CONSTRUCTOR_VALUES = ["Array", "Object", "String", "Number", "Boolean", "Function", "Symbol"] as const;
