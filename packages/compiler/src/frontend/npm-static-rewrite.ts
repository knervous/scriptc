// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { nodeFrontendServices } from "./services-node.js";
export function rewriteBundlerCjsExports(source: string, filePath: string): string | { degrade: string } | null {
  return nodeFrontendServices().rewriteCjs(source, filePath);
}
