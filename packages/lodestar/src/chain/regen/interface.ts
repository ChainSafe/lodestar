import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, phase0, Slot, RootHex, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointHex, CheckpointStateCache, StateContextCache} from "../stateCache";
import {IForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import {IEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/allForks";

/* eslint-disable @typescript-eslint/no-non-null-assertion */

export enum RegenCaller {
  getDuties = "getDuties",
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
/**
 * Regenerates states that have already been processed by the fork choice.
 *
 * State cache + regen have the purpose of providing all necessary states to the BeaconNode with the goal of:
 * - Keep as little states in memory as possible (optimize memory)
 * - Do as little work as possible (optimize performance)
 * - Provide requested states as fast as possible (optimize speed)
 *
 * Only a number of states are kept in memory to probabilistically serve most of the requests. Those states are
 * WeakRef-ed to prevent OOM in the states differ too much between them. The head state is always strong ref.
 *
 * Components that need states
 *
 * | Item                     | state                     | fn                           |
 * | ------------------------ | ------------------------- | ---------------------------- |
 * | block production         | head tree at req slot     | getHeadStateAtSlot()
 * | attestation production   | head tree at req slot     | getHeadStateAtSlot()
 * | get proposer duties      | head state at curr epoch  | getHeadStateAtCurrentEpoch()
 * | get attester duties      | head state at curr epoch  | getHeadStateAtCurrentEpoch()
 * |                          |                           |
 * | block processing         | block's preState          | getPreState()
 * | forkchoice justified bl  | justified state           | ?????
 * |                          |                           |
 * | gossip aggregate         | state w/ duties at target | getAttesterShuffling()
 * | gossip attestation       | state w/ duties at target | getAttesterShuffling()
 * | gossip block             | state w/ duties at parent | getProposerShuffling()
 * | gossip attester slashing | head state                | getHeadState()
 * | gossip proposer slashing | head state                | getHeadState()
 * | gossip voluntary exit    | head state at curr epoch  | getHeadStateAtCurrentEpoch()
 * | gossip sync committee    | head state                | getHeadState()
 * | gossip sync contribution | head state                | getHeadState()
 * |                          |                           |
 * | lightclient updater      | finalized state           | ?????
 * | lightclient initer       | finalized state           | ?????
 * |                          |                           |
 * | API - head               | head state                | getHeadState()
 * | API - genesis            | DB                        | ?????
 * | API - finalized          | ??                        | ?????
 * | API - justified          | ??                        | ?????
 * | API - some slot          | ??                        | ?????
 * | API - some hash          | ??                        | ?????
 */
export interface IStateCacheRegen {
  /**
   * Returns the current head state
   *
   * Used for:
   * - Gossip validation: attester_slashing, proposer_slashing, sync_committee, sync_contribution
   * - API requests: stateId = head
   * - TODO: Much more from chain
   */
  getHeadState(): CachedBeaconState<allForks.BeaconState>;

  /**
   * Returns the current head state dialed forward to current epoch. Note: only allows dialing forward
   *
   * Used for:
   * - Get proposer and attester duties
   * - Gossip validation: voluntary_exit
   *
   * Will never trigger replay, may trigger epoch transitions
   */
  getHeadStateAtEpoch(): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Returns the current head state dialed forward to slot, or a previous state if slot < head.slot.
   * Required to allow producing blocks and attestations for slots before the head.
   *
   * Used for:
   * - Block and attestation production
   *
   * May trigger replay (for past slots), may trigger epoch transitions
   */
  getHeadStateAtSlot(slot: Slot): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Returns a state that contains the right shufflings. Multiple states may satisfy this requirement, finds the
   * cheapest state that fullfils this requirement.
   *
   * TODO: May be replaced with a separate duties cache.
   * TODO: How should this be indexed?
   *
   * For proposer duties: input = parentRoot, blockSlot.
   * We want any state in blockEpoch whose last epoch transition is equal to blockSlot state.
   * So, that they have equal last processed block in blockEpoch - 1.
   *
   * There must exist and index that's similar to checkpoint for that points to epoch transitions,
   * epoch = state epoch AFTER state transition, block root = last block root in epoch - 1.
   *
   * ```ts
   * epochTransitionId = ${epoch}:${dependant_root}
   *
   * const epoch = computeEpochAtSlot(blockSlot)
   * const dependantRoot =
   *   if (computeEpochAtSlot(parentSlot) !== computeEpochAtSlot(blockSlot)) {
   *     return block.parentRoot
   *   } else if (parentSlot % SLOTS_PER_EPOCH === 0) {
   *     return parentBlock.parentRoot
   *   } else {
   *     const targetBlock = parentBlock.target
   *     return targetBlock.parentRoot
   *   }
   * ```
   *
   * If blockSlot % SLOTS_PER_EPOCH = 0, dependent root -> parentRoot
   *
   * Used for:
   * - Gossip validation: beacon_aggregate, beacon_block, attestation
   *
   * TODO: Should it trigger replay and / or epoch transitions?
   */
  getProposerShuffling(parentRoot: RootHex, blockSlot: Slot): Promise<ProposerShuffling>;

  getAttesterShuffling(targetCheckpoint: phase0.Checkpoint): Promise<AttesterShuffling>;

  /**
   * Return a valid pre-state for a beacon block. May be:
   * - If parent is in same epoch -> Exact state at `block.parentRoot`
   * - If parent is in prev epoch -> State after `block.parentRoot` dialed forward through epoch transition
   *
   * The returned state will always be in the same epoch to cache all epoch transitions
   *
   * Used for:
   * - Block validation (processBlock + processChainSegment)
   *
   * May trigger unbounded replay (in long non-finality) + epoch transitions
   */
  getPreState(block: allForks.BeaconBlock, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks>;

  /**
   * Return a valid checkpoint state
   * This will always return a state with `state.slot % SLOTS_PER_EPOCH === 0`
   */
  getCheckpointState(cp: phase0.Checkpoint, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState(blockRoot: RootHex, slot: Slot, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks>;
}

type ProposerShuffling = ValidatorIndex[];
type AttesterShuffling = IEpochShuffling;
// TODO: Use a raw array
// type AttesterShuffling = ValidatorIndex[];

type ShufflingCheckpoint = {
  epoch: Epoch;
  dependantRoot: RootHex;
};

export class StateCacheRegen implements IStateCacheRegen {
  private head: IProtoBlock & {prevTargetRoot: RootHex};
  private headState: CachedBeaconState<allForks.BeaconState>;
  private headShufflingCheckpoint: ShufflingCheckpoint;
  private forkChoice: IForkChoice;
  private stateCache: StateContextCache;
  private checkpointStateCache: CheckpointStateCache;

  private stateByShufflingCheckpoint: Map<Epoch, Map<RootHex, WeakRef<CachedBeaconState<allForks.BeaconState>>>>;

  getHeadState(): CachedBeaconState<allForks.BeaconState> {
    return this.headState;
  }

  async getHeadStateAtEpoch(): Promise<CachedBeaconState<allForks.BeaconState>> {
    //
  }

  async getProposerShuffling(parentRoot: RootHex, blockSlot: Slot): Promise<ProposerShuffling> {
    // In most cases this block will be descendant of the head, return early
    const blockEpoch = computeEpochAtSlot(blockSlot);
    const headEpoch = computeEpochAtSlot(this.head.slot);
    if (headEpoch === blockEpoch && this.head.blockRoot === parentRoot) {
      return this.headState.proposers;
    }

    // Otherwise, look for a state with the same shuffling checkpoint
    // else, trigger regen to get a state with shufflingCheckpoint
    const shufflingCheckpoint = getProposerShufflingCheckpoint(this.forkChoice, parentRoot, blockSlot);
    const shufflingState = await this.getStateWithShufflingCheckpoint(shufflingCheckpoint);
    return shufflingState.proposers;
  }

  /**
   * epoch: 0       1       2       3       4
   *        |-------|-------|-------|-------|
   * attestation slot ---------^
   *
   * We need either:
   * - state in epoch 1, next shuffling
   * - state in epoch 2, curr shuffling
   * - state in epoch 3, prev shuffling
   */
  async getAttesterShuffling(target: phase0.Checkpoint): Promise<AttesterShuffling> {
    // In most cases the head state will include this attester shufflings, return early
    const headEpoch = computeEpochAtSlot(this.head.slot);
    const targetRootHex = toHexString(target.root);

    // If the state is in the same epoch, compare target roots and return shufflings
    if (target.epoch === headEpoch && targetRootHex == this.head.targetRoot) {
      return this.headState.currentShuffling;
    }

    // If it's in previous epoch, compare the cached previous target root
    else if (target.epoch === headEpoch - 1 && targetRootHex === this.head.prevTargetRoot) {
      return this.headState.previousShuffling;
    }

    // Otherwise look for a state with the same shuffling checkpoint.
    // Note we can get next, curr, or prev shufflings from a state.
    const shufflingCheckpointNext = getAttesterShufflingCheckpointNext(this.forkChoice, target);
    const shufflingCheckpointCurr = getAttesterShufflingCheckpointCurr(this.forkChoice, target);

    // TODO: Which one is better to use? current or next
    const useNext = true;
    if (useNext) {
      const shufflingState = await this.getStateWithShufflingCheckpoint(shufflingCheckpointNext);
      return shufflingState.nextShuffling;
    } else {
      const shufflingState = await this.getStateWithShufflingCheckpoint(shufflingCheckpointCurr);
      return shufflingState.currentShuffling;
    }
  }

  private async getStateWithShufflingCheckpoint(
    shufflingCheckpoint: ShufflingCheckpoint
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    if (
      shufflingCheckpoint.epoch === this.headShufflingCheckpoint.epoch &&
      shufflingCheckpoint.dependantRoot === this.headShufflingCheckpoint.dependantRoot
    ) {
      return this.headState;
    }

    const stateWeakRef = this.stateByShufflingCheckpoint
      .get(shufflingCheckpoint.epoch)
      ?.get(shufflingCheckpoint.dependantRoot);
    if (stateWeakRef) {
      const state = stateWeakRef.deref();
      if (state) {
        return state;
      } else {
        this.stateByShufflingCheckpoint.get(shufflingCheckpoint.epoch)?.delete(shufflingCheckpoint.dependantRoot);
      }
    }
  }
}

/**
 * Return the ShufflingCheckpoint that decides the attester shuffling for a target checkpoint:
 * - The last block of -2 epochs of target.epoch
 */
function getAttesterShufflingCheckpointNext(forkChoice: IForkChoice, target: phase0.Checkpoint): ShufflingCheckpoint {
  const epoch = target.epoch;
  const block = forkChoice.getBlock(target.root)!;
  const epochM1LastBlock = forkChoice.getBlockHex(block.parentRoot)!;
  const epochM1Target = forkChoice.getBlockHex(epochM1LastBlock.targetRoot)!;
  const epochM2TLastBlock = forkChoice.getBlockHex(epochM1Target.parentRoot)!;
  return {dependantRoot: epochM2TLastBlock.blockRoot, epoch: epoch - 1};
}

function getAttesterShufflingCheckpointCurr(forkChoice: IForkChoice, target: phase0.Checkpoint): ShufflingCheckpoint {
  const epoch = target.epoch;
  const block = forkChoice.getBlock(target.root)!;
  const epochM1LastBlock = forkChoice.getBlockHex(block.parentRoot)!;
  return {dependantRoot: epochM1LastBlock.blockRoot, epoch};
}

/**
 * Return ShufflingCheckpoint that decides the propoer shuffling for a block:
 * - The last block in the previous epoch of `blockSlot`
 */
function getProposerShufflingCheckpoint(
  forkChoice: IForkChoice,
  parentRoot: RootHex,
  blockSlot: Slot
): ShufflingCheckpoint {
  const epoch = computeEpochAtSlot(blockSlot);
  const parentBlock = forkChoice.getBlockHex(parentRoot)!;
  const parentSlot = parentBlock.slot;

  if (computeEpochAtSlot(parentSlot) !== epoch) {
    return {dependantRoot: parentBlock.blockRoot, epoch};
  } else if (parentSlot % SLOTS_PER_EPOCH === 0) {
    return {dependantRoot: parentBlock.parentRoot, epoch};
  } else {
    const targetBlock = forkChoice.getBlockHex(parentBlock.targetRoot)!;
    return {dependantRoot: targetBlock.parentRoot, epoch};
  }
}

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegenerator extends IStateRegeneratorInternal {
  getHeadState(): CachedBeaconState<allForks.BeaconState> | null;

  /**
   * Set head in regen to trigger updating the head state.
   * Accepts an optional state parameter that may be the head for faster setting.
   * Otherwise it will look in the cache or trigger regen. If regen requires async work, the head will not be available
   * for some time, which can cause issues but will be resolved eventually.
   */
  setHead(head: IProtoBlock, potentialHeadState?: CachedBeaconState<allForks.BeaconState>): Promise<void>;

  /**
   * TEMP - To get justifiedBalances for the fork-choice.
   * Get checkpoint state from memory cache doing no regen
   */
  getCheckpointStateSync(cp: CheckpointHex): CachedBeaconState<allForks.BeaconState> | null;

  /**
   * TEMP - To get states from API
   * Get state from memory cache doing no regen
   */
  getStateSync(stateRoot: RootHex): CachedBeaconState<allForks.BeaconState> | null;

  /**
   * Add post to cache after verifying and importing block
   */
  addPostState(postState: CachedBeaconState<allForks.BeaconState>): void;
}
