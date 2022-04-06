export type Lockfile = {
  lockSync(path: string): void;
  unlockSync(path: string): void;
};

let lockFile: Lockfile | null = null;
export const LOCK_FILE_EXT = ".lock";
/**
 * When lockfile is imported, it registers listeners to process
 * Since it's only used by the validator client, require lazily to not pollute
 * beacon_node client context
 */
export async function getLockFile(): Promise<Lockfile> {
  if (!lockFile) {
    lockFile = (await import("lockfile")) as Lockfile;
  }
  return lockFile;
}
