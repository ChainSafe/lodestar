import {phase0, Slot, RootHex, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IProtoBlock} from "@chainsafe/lodestar-fork-choice";

export enum RegenCaller {
  getDuties = "getDuties",
  produceBlock = "produceBlock",
  precomputeEpoch = "precomputeEpoch",
  produceAttestationData = "produceAttestationData",
  processBlocksInEpoch = "processBlocksInEpoch",
  validateGossipBlock = "validateGossipBlock",
  validateGossipAggregateAndProof = "validateGossipAggregateAndProof",
  validateGossipAttestation = "validateGossipAttestation",
  validateGossipVoluntaryExit = "validateGossipVoluntaryExit",
  onForkChoiceFinalized = "onForkChoiceFinalized",
  regenHeadState = "regenHeadState",
}

export enum RegenFnName {
  getBlockSlotState = "getBlockSlotState",
  getState = "getState",
  getPreState = "getPreState",
  getCheckpointState = "getCheckpointState",
}

export type ProposerShuffling = ValidatorIndex[];
export type AttesterShuffling = allForks.IEpochShuffling;
// TODO: Use a raw array
// type AttesterShuffling = ValidatorIndex[];

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
 * | attestation production   | head tree at req epoch    | getHeadStateAtEpoch(attestationEpoch)
 * | get proposer duties      | head state at curr epoch  | getHeadStateAtEpoch(currentEpoch)
 * | get attester duties      | head state at curr epoch  | getHeadStateAtEpoch(currentEpoch)
 * |                          |                           |
 * | block processing         | block's preState          | getPreState()
 * | forkchoice justified bl  | justified state           | ?????
 * |                          |                           |
 * | gossip aggregate         | state w/ duties at target | getAttesterShuffling()
 * | gossip attestation       | state w/ duties at target | getAttesterShuffling()
 * | gossip block             | state w/ duties at parent | getProposerShuffling()
 * | gossip attester slashing | head state                | getHeadState()
 * | gossip proposer slashing | head state                | getHeadState()
 * | gossip voluntary exit    | head state at curr epoch  | getHeadStateAtEpoch(currentEpoch)
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
   * Trigger a regen and persistance of a new head state as a strong ref
   */
  setHead(head: IProtoBlock, potentialHeadState?: CachedBeaconState<allForks.BeaconState>): void;

  /**
   * Add post state to regen caches after applying `block`
   */
  addPostState(state: CachedBeaconState<allForks.BeaconState>, block: IProtoBlock): void;

  /**
   * Returns the current head state
   *
   * Used for:
   * - Gossip validation: attester_slashing, proposer_slashing, sync_committee, sync_contribution
   * - API requests: stateId = head
   * - TODO: Much more from chain
   */
  getHeadState(): CachedBeaconState<allForks.BeaconState> | null;

  /**
   * Returns the current head state dialed forward to current epoch. Note: only allows dialing forward
   *
   * Used for:
   * - Get proposer and attester duties
   * - Gossip validation: voluntary_exit
   *
   * Will never trigger replay, may trigger epoch transitions
   */
  getHeadStateAtEpoch(epoch: Epoch, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Returns the current head state dialed forward to slot, or a previous state if slot < head.slot.
   * Required to allow producing blocks and attestations for slots before the head.
   *
   * Used for:
   * - Block and attestation production
   *
   * May trigger replay (for past slots), may trigger epoch transitions
   */
  getHeadStateAtSlot(slot: Slot, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Returns the proposer shufflings for the block tree of `parentBlock` at the epoch of `blockSlot`.
   * Multiple states may have the required shufflings, this functions finds the cheapest state with them.
   *
   * TODO: May be replaced with a separate proposer duties cache.
   * TODO: How should this be indexed?
   *
   * For proposer duties: input = parentRoot, blockSlot.
   * We want any state in blockEpoch whose last epoch transition is equal to blockSlot state.
   * So, that they have equal last processed block in blockEpoch - 1.
   *
   * There must exist and index that's similar to checkpoint for that points to epoch transitions,
   * epoch = state epoch AFTER state transition, block root = last block root in epoch - 1.
   *
   * Used for:
   * - Gossip validation: beacon_aggregate, beacon_block, attestation
   *
   * TODO: Should it trigger replay and / or epoch transitions?
   */
  getProposerShuffling(parentBlock: IProtoBlock, blockSlot: Slot): Promise<ProposerShuffling>;

  /**
   * Returns the attestater shufflings for `targetCheckpoint`.
   *
   * Currently all states cache three attester shufflings:
   * - next shuffling: for state epoch + 1.
   * - curr shuffling: for state epoch.
   * - prev shuffling: for state epoch - 1.
   */
  getAttesterShuffling(targetCheckpoint: phase0.Checkpoint, rCaller: RegenCaller): Promise<AttesterShuffling>;

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
  getPreState(block: allForks.BeaconBlock, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Returns the closest state to postState.currentJustifiedCheckpoint in the same fork as postState
   *
   * From the spec https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/fork-choice.md#get_latest_attesting_balance
   * The state from which to read balances is:
   *
   * ```python
   * state = store.checkpoint_states[store.justified_checkpoint]
   * ```
   *
   * ```python
   * def store_target_checkpoint_state(store: Store, target: Checkpoint) -> None:
   *    # Store target checkpoint state if not yet seen
   *    if target not in store.checkpoint_states:
   *        base_state = copy(store.block_states[target.root])
   *        if base_state.slot < compute_start_slot_at_epoch(target.epoch):
   *            process_slots(base_state, compute_start_slot_at_epoch(target.epoch))
   *        store.checkpoint_states[target] = base_state
   * ```
   *
   * So the state to get justified balances is the post state of `checkpoint.root` dialed forward to the first slot in
   * `checkpoint.epoch` if that block is not in `checkpoint.epoch`.
   */
  getStateForJustifiedBalances(
    postState: CachedBeaconState<allForks.BeaconState>,
    blockParentRoot: RootHex
  ): CachedBeaconState<allForks.BeaconState>;

  /**
   * TEMP - To get states from API
   * Get state from memory cache doing no regen
   */
  getStateSync(stateRoot: RootHex): CachedBeaconState<allForks.BeaconState> | null;

  /** Use only for debugging and testing */
  dropStateCaches(): void;
}

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegeneratorInternal {
  /**
   * Return a valid pre-state for a beacon block
   * This will always return a state in the latest viable epoch
   */
  getPreState(block: allForks.BeaconBlock, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return a valid checkpoint state
   * This will always return a state with `state.slot % SLOTS_PER_EPOCH === 0`
   */
  getCheckpointState(cp: phase0.Checkpoint, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>>;
}
