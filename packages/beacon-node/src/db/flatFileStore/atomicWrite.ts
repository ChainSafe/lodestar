import {mkdir, open, rename, rm} from "node:fs/promises";
import path from "node:path";

/**
 * Atomic write: write to `.part` temp file -> datasync -> rename to target.
 * This guarantees crash-safe writes — if the process crashes mid-write,
 * only the `.part` file is corrupted, never the target.
 */
export async function atomicWrite(targetPath: string, data: Uint8Array): Promise<void> {
  const dir = path.dirname(targetPath);
  const partPath = `${targetPath}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(dir, {recursive: true});

  try {
    const fd = await open(partPath, "wx");
    try {
      await fd.writeFile(data);
      await fd.datasync();
    } finally {
      await fd.close();
    }

    await rename(partPath, targetPath);

    // Ensure rename metadata is durable on crash.
    const dirFd = await open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (e) {
    await rm(partPath, {force: true}).catch(() => {});
    throw e;
  }
}
