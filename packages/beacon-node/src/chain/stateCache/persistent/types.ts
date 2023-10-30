import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {CheckpointKey} from "../types.js";

// With fs implementation, persistentKey is ${CHECKPOINT_STATES_FOLDER/rootHex_epoch}
export type PersistentKey = string;

// Make this generic to support testing
export interface CPStatePersistentApis {
  write: (cpKey: CheckpointKey, state: CachedBeaconStateAllForks) => Promise<PersistentKey>;
  remove: (persistentKey: PersistentKey) => Promise<boolean>;
  read: (persistentKey: PersistentKey) => Promise<Uint8Array | null>;
  init: () => Promise<void>;
}
