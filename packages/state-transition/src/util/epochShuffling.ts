import {asyncUnshuffleList, unshuffleList} from "@chainsafe/swap-or-not-shuffle";
import {Epoch, RootHex, ssz, ValidatorIndex} from "@lodestar/types";
import {GaugeExtra, intDiv, Logger, NoLabels, toRootHex} from "@lodestar/utils";
import {
  DOMAIN_BEACON_ATTESTER,
  GENESIS_SLOT,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
  SHUFFLE_ROUND_COUNT,
} from "@lodestar/params";
import {BeaconConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "../types.js";
import {getSeed} from "./seed.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeAnchorCheckpoint} from "./computeAnchorCheckpoint.js";

export interface ShufflingBuildProps {
  state: BeaconStateAllForks;
  activeIndices: Uint32Array;
}

export interface PublicShufflingCacheMetrics {
  shufflingCache: {
    nextShufflingNotOnEpochCache: GaugeExtra<NoLabels>;
  };
}
export interface IShufflingCache {
  metrics: PublicShufflingCacheMetrics | null;
  logger: Logger | null;
  /**
   * Gets a cached shuffling via the epoch and decision root. If the state and
   * activeIndices are passed and a shuffling is not available it will be built
   * synchronously. If the state is not passed and the shuffling is not available
   * nothing will be returned.
   *
   * NOTE: If a shuffling is already queued and not calculated it will build and resolve
   * the promise but the already queued build will happen at some later time
   */
  getSync<T extends ShufflingBuildProps | undefined>(
    epoch: Epoch,
    decisionRoot: RootHex,
    buildProps?: T
  ): T extends ShufflingBuildProps ? EpochShuffling : EpochShuffling | null;

  /**
   * Gets a cached shuffling via the epoch and decision root.  Returns a promise
   * for the shuffling if it hs not calculated yet.  Returns null if a build has
   * not been queued nor a shuffling was calculated.
   */
  get(epoch: Epoch, decisionRoot: RootHex): Promise<EpochShuffling | null>;

  /**
   * Queue asynchronous build for an EpochShuffling
   */
  build(epoch: Epoch, decisionRoot: RootHex, state: BeaconStateAllForks, activeIndices: Uint32Array): void;
}

/**
 * Readonly interface for EpochShuffling.
 */
export type ReadonlyEpochShuffling = {
  readonly epoch: Epoch;
  readonly committees: Readonly<ValidatorIndex[][][]>;
};

export type EpochShuffling = {
  /**
   * Epoch being shuffled
   */
  epoch: Epoch;

  /**
   * Non-shuffled active validator indices
   */
  activeIndices: Uint32Array;

  /**
   * The active validator indices, shuffled into their committee
   */
  shuffling: Uint32Array;

  /**
   * List of list of committees Committees
   *
   * Committees by index, by slot
   *
   * Note: With a high amount of shards, or low amount of validators,
   * some shards may not have a committee this epoch
   */
  committees: Uint32Array[][];

  /**
   * Committees per slot, for fast attestation verification
   */
  committeesPerSlot: number;
};

export function computeCommitteeCount(activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, SLOTS_PER_EPOCH);
  const committeesPerSlot = intDiv(validatorsPerSlot, TARGET_COMMITTEE_SIZE);
  return Math.max(1, Math.min(MAX_COMMITTEES_PER_SLOT, committeesPerSlot));
}

function buildCommitteesFromShuffling(shuffling: Uint32Array): Uint32Array[][] {
  const activeValidatorCount = shuffling.length;
  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);
  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const committees = new Array<Uint32Array[]>(SLOTS_PER_EPOCH);
  for (let slot = 0; slot < SLOTS_PER_EPOCH; slot++) {
    const slotCommittees = new Array<Uint32Array>(committeesPerSlot);

    for (let committeeIndex = 0; committeeIndex < committeesPerSlot; committeeIndex++) {
      const index = slot * committeesPerSlot + committeeIndex;
      const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
      const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
      if (!(startOffset <= endOffset)) {
        throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
      }
      slotCommittees[committeeIndex] = shuffling.subarray(startOffset, endOffset);
    }

    committees[slot] = slotCommittees;
  }

  return committees;
}

export function computeEpochShuffling(
  // TODO: (@matthewkeil) remove state/epoch and pass in seed to clean this up
  state: BeaconStateAllForks,
  activeIndices: Uint32Array,
  epoch: Epoch
): EpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);
  const shuffling = unshuffleList(activeIndices, seed, SHUFFLE_ROUND_COUNT);
  const committees = buildCommitteesFromShuffling(shuffling);
  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
    committeesPerSlot: committees[0].length,
  };
}

export async function computeEpochShufflingAsync(
  // TODO: (@matthewkeil) remove state/epoch and pass in seed to clean this up
  state: BeaconStateAllForks,
  activeIndices: Uint32Array,
  epoch: Epoch
): Promise<EpochShuffling> {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);
  const shuffling = await asyncUnshuffleList(activeIndices, seed, SHUFFLE_ROUND_COUNT);
  const committees = buildCommitteesFromShuffling(shuffling);
  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
    committeesPerSlot: committees[0].length,
  };
}

function calculateDecisionRoot(state: BeaconStateAllForks, epoch: Epoch): RootHex {
  const pivotSlot = computeStartSlotAtEpoch(epoch - 1) - 1;
  return toRootHex(getBlockRootAtSlot(state, pivotSlot));
}

/**
 * Get the shuffling decision block root for the given epoch of given state
 *   - Special case close to genesis block, return the genesis block root
 *   - This is similar to forkchoice.getDependentRoot() function, otherwise we cannot get cached shuffing in attestation verification when syncing from genesis.
 */
export function calculateShufflingDecisionRoot(
  config: BeaconConfig,
  state: BeaconStateAllForks,
  epoch: Epoch
): RootHex {
  return state.slot > GENESIS_SLOT
    ? calculateDecisionRoot(state, epoch)
    : toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(computeAnchorCheckpoint(config, state).blockHeader));
}
