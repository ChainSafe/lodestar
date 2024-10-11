import path from "node:path";
import {phase0, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {ensureDir, readFile, readFileNames, removeFile, writeIfNotExist} from "../../../util/file.js";
import {CPStateDatastore, DatastoreKey} from "./types.js";

const CHECKPOINT_STATES_FOLDER = "checkpoint_states";
const CHECKPOINT_FILE_NAME_LENGTH = 82;

/**
 * Implementation of CPStateDatastore using file system, this is beneficial for debugging.
 */
export class FileCPStateDatastore implements CPStateDatastore {
  private readonly folderPath: string;

  constructor(parentDir: string = ".") {
    // by default use the beacon folder `/beacon/checkpoint_states`
    this.folderPath = path.join(parentDir, CHECKPOINT_STATES_FOLDER);
  }

  async init(): Promise<void> {
    try {
      await ensureDir(this.folderPath);
    } catch (_) {
      // do nothing
    }
  }

  async write(cpKey: phase0.Checkpoint, stateBytes: Uint8Array): Promise<DatastoreKey> {
    const serializedCheckpoint = ssz.phase0.Checkpoint.serialize(cpKey);
    const filePath = path.join(this.folderPath, toHex(serializedCheckpoint));
    await writeIfNotExist(filePath, stateBytes);
    return serializedCheckpoint;
  }

  async remove(serializedCheckpoint: DatastoreKey): Promise<void> {
    const filePath = path.join(this.folderPath, toHex(serializedCheckpoint));
    await removeFile(filePath);
  }

  async read(serializedCheckpoint: DatastoreKey): Promise<Uint8Array | null> {
    const filePath = path.join(this.folderPath, toHex(serializedCheckpoint));
    return readFile(filePath);
  }

  async readKeys(): Promise<DatastoreKey[]> {
    const fileNames = await readFileNames(this.folderPath);
    return fileNames
      .filter((fileName) => fileName.startsWith("0x") && fileName.length === CHECKPOINT_FILE_NAME_LENGTH)
      .map((fileName) => fromHex(fileName));
  }
}
