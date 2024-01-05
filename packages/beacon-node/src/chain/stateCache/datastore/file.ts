import path from "node:path";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {phase0, ssz} from "@lodestar/types";
import {ensureDir, readFile, readFileNames, removeFile, writeIfNotExist} from "../../../util/file.js";
import {CPStateDatastore, DatastoreKey} from "./types.js";

export const CHECKPOINT_STATES_FOLDER = "./checkpoint_states";

/**
 * Implementation of CPStatePersistentApis using file system, this is beneficial for debugging.
 */
export class FileCPStateDatastore implements CPStateDatastore {
  constructor(private readonly folderPath: string) {}

  async init(): Promise<void> {
    try {
      await ensureDir(this.folderPath);
    } catch (_) {
      // do nothing
    }
  }

  async write(cpKey: phase0.Checkpoint, stateBytes: Uint8Array): Promise<DatastoreKey> {
    const serializedCheckpoint = ssz.phase0.Checkpoint.serialize(cpKey);
    const filePath = path.join(this.folderPath, toHexString(serializedCheckpoint));
    await writeIfNotExist(filePath, stateBytes);
    return serializedCheckpoint;
  }

  async remove(serializedCheckpoint: DatastoreKey): Promise<void> {
    const filePath = path.join(this.folderPath, toHexString(serializedCheckpoint));
    await removeFile(filePath);
  }

  async read(serializedCheckpoint: DatastoreKey): Promise<Uint8Array | null> {
    const filePath = path.join(this.folderPath, toHexString(serializedCheckpoint));
    return readFile(filePath);
  }

  async readKeys(): Promise<DatastoreKey[]> {
    const fileNames = await readFileNames(this.folderPath);
    // TODO: filter file names with fixed size
    return fileNames.map((fileName) => fromHexString(fileName));
  }
}
