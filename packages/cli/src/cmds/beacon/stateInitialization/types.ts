import {IBeaconDb} from "@lodestar/beacon-node";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {IBeaconStateView, StateBytesMetadata, WeakSubjectivitySummary} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {Logger} from "@lodestar/utils";
import {GlobalArgs} from "../../../options/globalOptions.js";
import {BeaconArgs} from "../options.js";

export type StateInitializationOptions = Pick<
  BeaconArgs & GlobalArgs,
  | "checkpointState"
  | "checkpointSyncUrl"
  | "unsafeCheckpointState"
  | "lastPersistedCheckpointState"
  | "genesisStateFile"
  | "wssCheckpoint"
  | "forceCheckpointSync"
  | "ignoreWeakSubjectivityCheck"
  | "network"
  | "chain.nHistoricalStatesFileDataStore"
  | "chain.nativeStateTransition"
>;

export type StatePreparationContext = {
  chainForkConfig: ChainForkConfig;
  db: IBeaconDb;
  dataDir: string;
  logger: Logger;
};

export type ArchivedStateBytes = {
  stateBytes: Uint8Array;
  metadata: StateBytesMetadata;
  weakSubjectivity: WeakSubjectivitySummary;
  isWithinWeakSubjectivityPeriod: boolean;
};

export type CheckpointStateBytesCandidate = {
  stateBytes: Uint8Array;
  expectedCheckpoint: Checkpoint | null;
  source: "checkpoint file" | "checkpointSyncUrl" | "unfinalized source";
};

export type CheckpointStartupPolicy = {
  isFinalized: boolean;
  forceCheckpointSync: boolean;
  ignoreWeakSubjectivityCheck: boolean;
};

/** Selected state bytes and source-specific initialization steps. */
export type StateInitialization = {
  stateBytes: Uint8Array;
  config: BeaconConfig;
  isFinalized: boolean;
  validate: (state: IBeaconStateView) => void;
  initializeEarliestAvailableSlot: (state: IBeaconStateView) => Promise<Slot>;
  persist: ((state: IBeaconStateView, stateBytes: Uint8Array) => Promise<void>) | null;
  log: (state: IBeaconStateView, nativeStateTransition: boolean) => void;
};
