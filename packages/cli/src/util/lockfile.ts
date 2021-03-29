type Lockfile = {
  lockSync(path: string): void;
  unlockSync(path: string): void;
};

let lockFile: Lockfile | null = null;

/**
 * When lockfile it's required it registers listeners to process
 * Since it's only used by the validator client, require lazily to not pollute
 * beacon_node client context
 */
export function getLockFile(): Lockfile {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  if (!lockFile) lockFile = require("lockfile") as Lockfile;
  return lockFile;
}
