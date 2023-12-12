import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";
import {CPStatePersistentApis, PersistedKey} from "./types.js";

/**
 * Implementation of CPStatePersistentApis using db.
 */
export class DbPersistentApis implements CPStatePersistentApis {
  constructor(private readonly db: IBeaconDb) {}

  async write(cpKey: phase0.Checkpoint, state: CachedBeaconStateAllForks): Promise<PersistedKey> {
    const serializedCheckpoint = checkpointToKey(cpKey);
    const stateBytes = state.serialize();
    await this.db.checkpointState.putBinary(serializedCheckpoint, stateBytes);
    return serializedCheckpoint;
  }

  async remove(serializedCheckpoint: PersistedKey): Promise<void> {
    await this.db.checkpointState.delete(serializedCheckpoint);
  }

  async read(serializedCheckpoint: PersistedKey): Promise<Uint8Array | null> {
    return this.db.checkpointState.getBinary(serializedCheckpoint);
  }

  async readKeys(): Promise<PersistedKey[]> {
    return this.db.checkpointState.keys();
  }

  persistedKeyToCheckpoint(key: PersistedKey): phase0.Checkpoint {
    return ssz.phase0.Checkpoint.deserialize(key);
  }
}

export function checkpointToKey(cp: phase0.Checkpoint): PersistedKey {
  return ssz.phase0.Checkpoint.serialize(cp);
}
