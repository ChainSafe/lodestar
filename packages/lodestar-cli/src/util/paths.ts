import path from "path";
import expandTilde from "expand-tilde";

/**
 * Expands and resolves a path.
 * Tilde expansion is particular to bash.
 * See https://github.com/nodejs/node/issues/684
 * @param unsafePath "~/dir"
 * @returns "/users/john/dir"
 */
export function resolveTildePath(unsafePath: string): string {
  return path.resolve(expandTilde(unsafePath));
}