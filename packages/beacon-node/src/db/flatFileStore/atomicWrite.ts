import {mkdir, open, rename, rm} from "node:fs/promises";
import path from "node:path";

const pendingDirectorySyncs = new Map<string, string[]>();

/**
 * Atomic write: write to `.part` temp file -> datasync -> rename to target.
 * This guarantees crash-safe writes — if the process crashes mid-write,
 * only the `.part` file is corrupted, never the target.
 */
export async function atomicWrite(targetPath: string, data: Uint8Array): Promise<void> {
  const dir = path.dirname(targetPath);
  const partPath = `${targetPath}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdirDurable(dir);

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
    await syncDirectory(dir);
  } catch (e) {
    await rm(partPath, {force: true}).catch(() => {});
    throw e;
  }
}

export async function mkdirDurable(dir: string): Promise<void> {
  const targetDir = path.resolve(dir);
  let directoriesToSync = pendingDirectorySyncs.get(targetDir);
  if (directoriesToSync === undefined) {
    const firstCreatedDir = await mkdir(targetDir, {recursive: true});
    if (firstCreatedDir === undefined) return;

    let createdDir = path.resolve(firstCreatedDir);
    directoriesToSync = [path.dirname(createdDir)];
    while (createdDir !== targetDir) {
      directoriesToSync.push(createdDir);
      const [nextSegment] = path.relative(createdDir, targetDir).split(path.sep);
      createdDir = path.join(createdDir, nextSegment);
    }
    pendingDirectorySyncs.set(targetDir, directoriesToSync);
  }

  for (const directory of directoriesToSync) {
    await syncDirectory(directory);
  }
  pendingDirectorySyncs.delete(targetDir);
}

async function syncDirectory(dir: string): Promise<void> {
  const dirFd = await open(dir, "r");
  try {
    await dirFd.sync();
  } finally {
    await dirFd.close();
  }
}
