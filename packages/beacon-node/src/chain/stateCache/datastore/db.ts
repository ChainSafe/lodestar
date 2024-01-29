import {phase0, ssz} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";
import {CPStateDatastore, DatastoreKey} from "./types.js";

/**
 * Implementation of CPStateDatastore using db.
 */
export class DbCPStateDatastore implements CPStateDatastore {
  constructor(private readonly db: IBeaconDb) {}

  async write(cpKey: phase0.Checkpoint, stateBytes: Uint8Array): Promise<DatastoreKey> {
    const serializedCheckpoint = checkpointToDatastoreKey(cpKey);
    await this.db.checkpointState.putBinary(serializedCheckpoint, stateBytes);
    return serializedCheckpoint;
  }

  async remove(serializedCheckpoint: DatastoreKey): Promise<void> {
    await this.db.checkpointState.delete(serializedCheckpoint);
  }

  async read(serializedCheckpoint: DatastoreKey): Promise<Uint8Array | null> {
    return this.db.checkpointState.getBinary(serializedCheckpoint);
  }

  async readKeys(): Promise<DatastoreKey[]> {
    return this.db.checkpointState.keys();
  }
}

export function datastoreKeyToCheckpoint(key: DatastoreKey): phase0.Checkpoint {
  return ssz.phase0.Checkpoint.deserialize(key);
}

export function checkpointToDatastoreKey(cp: phase0.Checkpoint): DatastoreKey {
  return ssz.phase0.Checkpoint.serialize(cp);
}
