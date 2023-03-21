import {allForks, phase0, Slot, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";

export enum RegenCaller {
  getDuties = "getDuties",
  processBlock = "processBlock",
  produceBlock = "produceBlock",
  validateGossipBlock = "validateGossipBlock",
  precomputeEpoch = "precomputeEpoch",
  produceAttestationData = "produceAttestationData",
  processBlocksInEpoch = "processBlocksInEpoch",
  validateGossipAggregateAndProof = "validateGossipAggregateAndProof",
  validateGossipAttestation = "validateGossipAttestation",
  onForkChoiceFinalized = "onForkChoiceFinalized",
}

export enum RegenFnName {
  getBlockSlotState = "getBlockSlotState",
  getState = "getState",
  getPreState = "getPreState",
  getCheckpointState = "getCheckpointState",
}

export type StateCloneOpts = {
  dontTransferCache: boolean;
};

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegenerator {
  /**
   * Return a valid pre-state for a beacon block
   * This will always return a state in the latest viable epoch
   */
  getPreState(
    block: allForks.BeaconBlock,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks>;

  /**
   * Return a valid checkpoint state
   * This will always return a state with `state.slot % SLOTS_PER_EPOCH === 0`
   */
  getCheckpointState(
    cp: phase0.Checkpoint,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks>;
}
