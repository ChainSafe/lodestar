import fs from "node:fs";
import path from "node:path";
import {removeFile, writeIfNotExist, ensureDir, readAllFileNames} from "@lodestar/utils";
import {CheckpointKey} from "../types.js";
import {CPStatePersistentApis, PersistentKey} from "./types.js";

/**
 * Implementation of CPStatePersistentApis using file system.
 */
export class FilePersistentApis implements CPStatePersistentApis {
  constructor(private readonly folderPath: string) {
    void ensureEmptyFolder(folderPath);
  }

  async write(checkpointKey: CheckpointKey, bytes: Uint8Array): Promise<PersistentKey> {
    const persistentKey = this.toPersistentKey(checkpointKey);
    await writeIfNotExist(persistentKey, bytes);
    return persistentKey;
  }

  async remove(persistentKey: PersistentKey): Promise<boolean> {
    return removeFile(persistentKey);
  }

  async read(persistentKey: PersistentKey): Promise<Uint8Array> {
    return fs.promises.readFile(persistentKey);
  }

  private toPersistentKey(checkpointKey: CheckpointKey): PersistentKey {
    return path.join(this.folderPath, checkpointKey);
  }
}

async function ensureEmptyFolder(folderPath: string): Promise<void> {
  try {
    await ensureDir(folderPath);
    const fileNames = await readAllFileNames(folderPath);
    for (const fileName of fileNames) {
      await removeFile(path.join(folderPath, fileName));
    }
  } catch (_) {
    // do nothing
  }
}
