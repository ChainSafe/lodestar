import {Epoch, phase0, ssz} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";
import {CPStateDatastore, DatastoreKey} from "./types.js";
import {MapDef} from "@lodestar/utils";

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

  async readLatestSafe(): Promise<Uint8Array | null> {
    const allKeys = await this.readKeys();
    if (allKeys.length === 0) return null;

    const latest = getLatestSafeDatastoreKey(allKeys);

    if (latest == null) {
      return null;
    }

    return this.read(latest);
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

/**
 * Get the latest checkpoint state that is unique in its epoch
 */
export function getLatestSafeDatastoreKey(allKeys: DatastoreKey[]): DatastoreKey | null {
  const checkpointsByEpoch = new MapDef<Epoch, DatastoreKey[]>(() => []);
    for (const key of allKeys) {
      const cp = datastoreKeyToCheckpoint(key);
      checkpointsByEpoch.getOrDefault(cp.epoch).push(key);
    }

    let latest: DatastoreKey | null = null;
    let latestEpoch = 0;
    for (const [epoch, keys] of checkpointsByEpoch.entries()) {
      // filter out epochs with only 1 checkpoint
      if (keys.length === 1 && epoch > latestEpoch) {
        latest = keys[0];
        latestEpoch = epoch;
      }
    }

    return latest;
}
