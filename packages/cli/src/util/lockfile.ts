import {lockSync, unlockSync} from "proper-lockfile";

/**
 * Creates a .lock file for `filepath`, argument passed must not be the lock path
 * @param filepath File to lock, i.e. `keystore_0001.json`
 */
export function lockFilepath(filepath: string): void {
  try {
    lockSync(filepath, {
      // Allows to lock files that do not exist
      realpath: false,
    });
  } catch (e) {
    if (isLockfileError(e) && (e.code === "ELOCKED" || e.code === "ENOTDIR")) {
      e.message = `'${filepath}' already in use by another process`;
    }
    throw e;
  }
}

/**
 * Deletes a .lock file for `filepath`, argument passed must not be the lock path
 * @param filepath File to unlock, i.e. `keystore_0001.json`
 */
export function unlockFilepath(filepath: string): void {
  try {
    unlockSync(filepath, {
      // Allows to unlock files that do not exist
      realpath: false,
    });
  } catch (e) {
    if (isLockfileError(e) && e.code === "ENOTACQUIRED") {
      // Do not throw if the lock file is already deleted
      return;
    }
    throw e;
  }
}

// https://github.com/moxystudio/node-proper-lockfile/blob/9f8c303c91998e8404a911dc11c54029812bca69/lib/lockfile.js#L53
export type LockfileError = Error & {code: "ELOCKED" | "ENOTACQUIRED" | "ENOTDIR"};

function isLockfileError(e: unknown): e is LockfileError {
  return e instanceof Error && (e as LockfileError).code !== undefined;
}
