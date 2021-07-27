import {allForks, phase0, Root, Slot} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IGauge} from "../../metrics";

export interface IRegenFnMetrics {
  stateLookupsTotal: IGauge;
  stateLookupHits: IGauge;
  stateCpLookupsTotal: IGauge;
  stateCpLookupsHits: IGauge;
}

export enum RegenCaller {
  getProposerAttesterDuties = "getProposerAttesterDuties",
  produceBlock = "produceBlock",
  validateGossipBlock = "validateGossipBlock",
  produceAttestationData = "produceAttestationData",
  getStateByBlockRoot = "getStateByBlockRoot",
  processBlocksInEpoch = "processBlocksInEpoch",
  validateGossipAggregateAndProof = "validateGossipAggregateAndProof",
  validateGossipAttestation = "validateGossipAttestation",
  validateGossipVoluntaryExit = "validateGossipVoluntaryExit",
  onForkChoiceFinalized = "onForkChoiceFinalized",
  dummyCallerfromTests = "dummyCallerfromTests",
}

export enum RegenFnName {
  getBlockSlotState = "getBlockSlotState",
  getState = "getState",
  getPreState = "getPreState",
  getCheckpointState = "getCheckpointState",
}

export interface IRegenCaller {
  entrypoint?: RegenFnName;
  caller: RegenCaller;
}

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegenerator {
  /**
   * Return a valid pre-state for a beacon block
   * This will always return a state in the latest viable epoch
   */
  getPreState: (block: allForks.BeaconBlock, rCaller: IRegenCaller) => Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return a valid checkpoint state
   * This will always return a state with `state.slot % SLOTS_PER_EPOCH === 0`
   */
  getCheckpointState: (
    cp: phase0.Checkpoint,
    rCaller: IRegenCaller
  ) => Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState: (
    blockRoot: Root,
    slot: Slot,
    rCaller: IRegenCaller
  ) => Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState: (stateRoot: Root, rCaller: IRegenCaller) => Promise<CachedBeaconState<allForks.BeaconState>>;
}
