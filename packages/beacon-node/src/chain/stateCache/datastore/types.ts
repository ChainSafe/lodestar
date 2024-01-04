import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";

// With db implementation, persistedKey is serialized data of a checkpoint
export type DatastoreKey = Uint8Array;

// Make this generic to support testing
export interface CPStateDatastore {
  write: (cpKey: phase0.Checkpoint, state: CachedBeaconStateAllForks) => Promise<DatastoreKey>;
  remove: (key: DatastoreKey) => Promise<void>;
  read: (key: DatastoreKey) => Promise<Uint8Array | null>;
  readKeys: () => Promise<DatastoreKey[]>;
}
