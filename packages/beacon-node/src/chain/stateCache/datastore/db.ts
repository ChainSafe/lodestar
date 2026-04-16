import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, phase0, ssz} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {
  getLastProcessedSlotFromBeaconStateSerialized,
  getSlotFromBeaconStateSerialized,
} from "../../../util/sszBytes.js";
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

  async readLatestSafe(): Promise<Uint8Array | null> {
    const allKeys = await this.readKeys();
    if (allKeys.length === 0) return null;

    return getLatestSafeDatastoreKey(allKeys, this.read.bind(this));
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
 * Get the latest safe checkpoint state the node can use to boot from
 *   - it should be the checkpoint state that's unique in its epoch
 *   - its last processed block slot should be at epoch boundary or last slot of previous epoch
 *   - state slot should be at epoch boundary
 *   - state slot should be equal to epoch * SLOTS_PER_EPOCH
 *
 * return the serialized data of Current Root Checkpoint State (CRCS) or Previous Root Checkpoint State (PRCS)
 *
 */
export async function getLatestSafeDatastoreKey(
  allKeys: DatastoreKey[],
  readFn: (key: DatastoreKey) => Promise<Uint8Array | null>
): Promise<Uint8Array | null> {
  const checkpointsByEpoch = new MapDef<Epoch, DatastoreKey[]>(() => []);
  for (const key of allKeys) {
    const cp = datastoreKeyToCheckpoint(key);
    checkpointsByEpoch.getOrDefault(cp.epoch).push(key);
  }

  const dataStoreKeyByEpoch: Map<Epoch, DatastoreKey> = new Map();
  for (const [epoch, keys] of checkpointsByEpoch.entries()) {
    // only consider epochs with a single checkpoint to avoid ambiguity from forks
    if (keys.length === 1) {
      dataStoreKeyByEpoch.set(epoch, keys[0]);
    }
  }

  const epochsDesc = Array.from(dataStoreKeyByEpoch.keys()).sort((a, b) => b - a);
  for (const epoch of epochsDesc) {
    const datastoreKey = dataStoreKeyByEpoch.get(epoch);
    if (datastoreKey == null) {
      // should not happen
      continue;
    }

    const stateBytes = await readFn(datastoreKey);
    if (stateBytes == null) {
      // should not happen
      continue;
    }

    const lastProcessedSlot = getLastProcessedSlotFromBeaconStateSerialized(stateBytes);
    if (lastProcessedSlot == null) {
      // cannot extract last processed slot from serialized state, skip
      continue;
    }

    const stateSlot = getSlotFromBeaconStateSerialized(stateBytes);
    if (stateSlot == null) {
      // cannot extract slot from serialized state, skip
      continue;
    }

    if (lastProcessedSlot !== stateSlot && lastProcessedSlot !== stateSlot - 1) {
      // not CRCS or PRCS, skip
      continue;
    }

    if (stateSlot % SLOTS_PER_EPOCH !== 0) {
      // not at epoch boundary, skip
      continue;
    }

    if (stateSlot !== SLOTS_PER_EPOCH * epoch) {
      // should not happen after above checks, but just to be safe
      continue;
    }

    return stateBytes;
  }

  return null;
}
