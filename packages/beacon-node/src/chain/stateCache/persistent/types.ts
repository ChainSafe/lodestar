import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";

// With db implementation, persistentKey is serialized data of a checkpoint
export type PersistentKey = Uint8Array;

// Make this generic to support testing
export interface CPStatePersistentApis {
  write: (cpKey: phase0.Checkpoint, state: CachedBeaconStateAllForks) => Promise<PersistentKey>;
  remove: (persistentKey: PersistentKey) => Promise<void>;
  read: (persistentKey: PersistentKey) => Promise<Uint8Array | null>;
  readKeys: () => Promise<PersistentKey[]>;
  persistentKeyToCheckpoint: (persistentKey: PersistentKey) => phase0.Checkpoint;
}
