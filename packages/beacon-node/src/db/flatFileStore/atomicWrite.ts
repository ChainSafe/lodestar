import fs from "node:fs";
import path from "node:path";

/**
 * Atomic write: write to `.part` temp file -> datasync -> rename to target.
 * This guarantees crash-safe writes — if the process crashes mid-write,
 * only the `.part` file is corrupted, never the target.
 */
export async function atomicWrite(targetPath: string, data: Uint8Array): Promise<void> {
  const dir = path.dirname(targetPath);
  const partPath = `${targetPath}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.promises.mkdir(dir, {recursive: true});

  try {
    const fd = await fs.promises.open(partPath, "wx");
    try {
      await fd.writeFile(data);
      await fd.datasync();
    } finally {
      await fd.close();
    }

    await fs.promises.rename(partPath, targetPath);

    // Ensure rename metadata is durable on crash.
    const dirFd = await fs.promises.open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (e) {
    await fs.promises.rm(partPath, {force: true}).catch(() => {});
    throw e;
  }
}

/**
 * Zero-pad a slot number to 12 digits for lexicographic ordering in directory names.
 * Max slot ~2^63 fits in 19 digits, 12 is enough for many centuries of Ethereum.
 */
export function padSlot(slot: number): string {
  return String(slot).padStart(12, "0");
}

/**
 * Clean up any `.part` files in a directory tree (non-recursive single level).
 */
export async function cleanupPartFiles(dir: string): Promise<number> {
  let cleaned = 0;
  try {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Recurse into slot directories
        const subdir = path.join(dir, entry.name);
        const subEntries = await fs.promises.readdir(subdir);
        for (const subEntry of subEntries) {
          if (subEntry.endsWith(".part") || subEntry.includes(".part-")) {
            await fs.promises.rm(path.join(subdir, subEntry), {force: true});
            cleaned++;
          }
        }
      }
    }
  } catch (_e) {
    // Directory may not exist yet
  }
  return cleaned;
}
