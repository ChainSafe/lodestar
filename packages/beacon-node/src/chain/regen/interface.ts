import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {IBeaconStateView} from "@lodestar/state-transition";
import {BeaconBlock, Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import {CheckpointHexPayload} from "../stateCache/types.js";

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
  validateGossipExecutionPayloadBid = "validateGossipExecutionPayloadBid",
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
  getCheckpointStateOrBytes(cp: CheckpointHexPayload): Promise<IBeaconStateView | Uint8Array | null>;
  getCheckpointStateSync(cp: CheckpointHexPayload): IBeaconStateView | null;
  getClosestHeadState(head: ProtoBlock): IBeaconStateView | null;
  pruneOnCheckpoint(finalizedEpoch: Epoch, justifiedEpoch: Epoch, headStateRoot: RootHex): void;
  pruneOnFinalized(finalizedEpoch: Epoch): void;
  /**
   * Process block state for caching and memory management (after stateTransition).
   * Manages both block state and payload state variants together based on root canonicality.
   * Should be called once per block import, not separately for block state and payload state.
   * @param blockRootHex - Block root hex
   * @param postState - Cached beacon state after block processing
   */
  processBlockState(blockRootHex: RootHex, postState: IBeaconStateView): void;
  /**
   * Process payload state for caching (after processExecutionPayloadEnvelope).
   * Only called for Gloas blocks that have payloads revealed.
   * @param blockRootHex - Block root hex
   * @param payloadState - Cached beacon state after payload processing
   */
  processPayloadState(payloadState: IBeaconStateView): void;
  /**
   * Add checkpoint state to cache.
   * @param cp - Checkpoint (epoch + root)
   * @param item - Cached beacon state
   * @param payloadPresent - For Gloas: true if this is payload state, false if block state.
   *                         Always true for pre-Gloas.
   */
  addCheckpointState(cp: phase0.Checkpoint, item: IBeaconStateView, payloadPresent: boolean): void;
  updateHeadState(newHead: ProtoBlock, maybeHeadState: IBeaconStateView): void;
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch, payloadPresent: boolean): number | null;
  upgradeForGloas(epoch: Epoch): void;
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
