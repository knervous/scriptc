// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
/** A compiler invariant failed. Callers can distinguish these bugs from
 * environmental failures such as filesystem and toolchain errors. */
export class InternalCompilerError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InternalCompilerError";
  }
}
