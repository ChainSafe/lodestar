import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, Root, Slot} from "@lodestar/types";
import {CheckpointHex} from "../../../../chain/index.js";

export interface ValidatorEndpointDependencies {
  waitForSlotWithDisparity(slot: Slot): Promise<void>;
  notWhileSyncing(): void;
  notOnOptimisticBlockRoot(root: Root): void;
  getGenesisBlockRoot(state: CachedBeaconStateAllForks): Promise<Root>;
  waitForNextClosestEpoch(): Promise<void>;
  currentEpochWithDisparity(): Epoch;
  msToNextEpoch(): number;
  waitForCheckpointState(cpHex: CheckpointHex): Promise<CachedBeaconStateAllForks | null>;
}
