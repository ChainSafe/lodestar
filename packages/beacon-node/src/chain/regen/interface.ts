import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {IBeaconStateView} from "@lodestar/state-transition";
import {BeaconBlock, Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import {CheckpointHex} from "../stateCache/types.js";

export enum RegenCaller {
  getDuties = "getDuties",
  processBlock = "processBlock",
  produceBlock = "produceBlock",
  validateGossipBlock = "validateGossipBlock",
  validateGossipPayloadEnvelope = "validateGossipPayloadEnvelope",
  validateGossipBlob = "validateGossipBlob",
  validateGossipDataColumn = "validateGossipDataColumn",
  validateGossipExecutionPayloadEnvelope = "validateGossipExecutionPayloadEnvelope",
  precomputeEpoch = "precomputeEpoch",
  predictProposerHead = "predictProposerHead",
  produceAttestationData = "produceAttestationData",
  processBlocksInEpoch = "processBlocksInEpoch",
  validateGossipAggregateAndProof = "validateGossipAggregateAndProof",
  validateGossipAttestation = "validateGossipAttestation",
  validateGossipVoluntaryExit = "validateGossipVoluntaryExit",
  validateApiVoluntaryExit = "validateApiVoluntaryExit",
  publishDeferredVoluntaryExits = "publishDeferredVoluntaryExits",
  validateGossipExecutionPayloadBid = "validateGossipExecutionPayloadBid",
  validateGossipProposerPreferences = "validateGossipProposerPreferences",
  onForkChoiceFinalized = "onForkChoiceFinalized",
  restApi = "restApi",
}

export enum RegenFnName {
  getBlockSlotState = "getBlockSlotState",
  getState = "getState",
  getPreState = "getPreState",
}

export type StateRegenerationOpts = {
  dontTransferCache: boolean;
};

export interface IStateRegenerator extends IStateRegeneratorInternal {
  dropCache(): void;
  dumpCacheSummary(): routes.lodestar.StateCacheItem[];
  getStateSync(stateRoot: RootHex): IBeaconStateView | null;
  getPreStateSync(block: BeaconBlock): IBeaconStateView | null;
  getCheckpointStateOrBytes(cp: CheckpointHex): Promise<IBeaconStateView | Uint8Array | null>;
  getCheckpointStateSync(cp: CheckpointHex): IBeaconStateView | null;
  getClosestHeadState(head: ProtoBlock): IBeaconStateView | null;
  pruneOnCheckpoint(finalizedEpoch: Epoch, justifiedEpoch: Epoch, headStateRoot: RootHex): void;
  pruneOnFinalized(finalizedEpoch: Epoch): void;
  processState(blockRootHex: RootHex, postState: IBeaconStateView): void;
  addCheckpointState(cp: phase0.Checkpoint, item: IBeaconStateView): void;
  updateHeadState(newHead: ProtoBlock, maybeHeadState: IBeaconStateView): void;
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null;
}

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegeneratorInternal {
  /**
   * Return a valid pre-state for a beacon block
   * This will always return a state in the latest viable epoch
   */
  getPreState(block: BeaconBlock, opts: StateRegenerationOpts, rCaller: RegenCaller): Promise<IBeaconStateView>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState(
    block: ProtoBlock,
    slot: Slot,
    opts: StateRegenerationOpts,
    rCaller: RegenCaller
  ): Promise<IBeaconStateView>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<IBeaconStateView>;
}
