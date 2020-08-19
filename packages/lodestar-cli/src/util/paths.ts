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

/**
 * path.join but when the base is an absolute path, does not join
 */
export function joinIfRelative(dir: string, base: string): string {
  return path.isAbsolute(base) ? base : path.join(dir, base);
}
