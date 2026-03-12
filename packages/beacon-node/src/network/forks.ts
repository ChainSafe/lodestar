import {ChainForkConfig, ForkBoundary} from "@lodestar/config";
import {Epoch} from "@lodestar/types";

/**
 * Subscribe topics to the new fork N epochs before the fork. Remove all subscriptions N epochs after the fork
 *
 * This lookahead ensures a smooth fork transition. During `FORK_EPOCH_LOOKAHEAD` both forks will be active.
 *
 * ```
 *    phase0     phase0     phase0       -
 *      -        altair     altair     altair
 * |----------|----------|----------|----------|
 * 0        fork-2      fork      fork+2       oo
 * ```
 *
 * It the fork epochs are very close to each other there may more than two active at once
 *
 * ```
 *   f0    f0   f0    f0   f0    -
 *   -     fa   fa    fa   fa    fa   -
 *   -     -    fb    fb   fb    fb   fb
 *
 *     forka-2    forka      forka+2
 * |     |          |          |
 * |----------|----------|----------|----------|
 * 0        forkb-2    forkb      forkb+2      oo
 * ```
 */
export const FORK_EPOCH_LOOKAHEAD = 2;

/**
 * Return the list of `ForkBoundary`s meant to be active at `epoch`
 * @see FORK_EPOCH_LOOKAHEAD for details on when fork boundaries are considered 'active'
 */
export function getActiveForkBoundaries(config: ChainForkConfig, epoch: Epoch): ForkBoundary[] {
  const activeBoundaries: ForkBoundary[] = [];
  const {forkBoundariesAscendingEpochOrder} = config;

  for (let i = 0; i < forkBoundariesAscendingEpochOrder.length; i++) {
    const currentForkBoundary = forkBoundariesAscendingEpochOrder[i];
    const nextForkBoundary = forkBoundariesAscendingEpochOrder[i + 1];

    const currentEpoch = currentForkBoundary.epoch;
    const nextEpoch = nextForkBoundary !== undefined ? nextForkBoundary.epoch : Infinity;

    // Edge case: If multiple fork boundaries start at the same epoch, only consider the latest one
    if (currentEpoch === nextEpoch) {
      continue;
    }

    if (epoch >= currentEpoch - FORK_EPOCH_LOOKAHEAD && epoch <= nextEpoch + FORK_EPOCH_LOOKAHEAD) {
      activeBoundaries.push(currentForkBoundary);
    }
  }

  return activeBoundaries;
}

/**
 * Return the currentBoundary and nextBoundary given a fork/BPO schedule and `epoch`
 */
export function getCurrentAndNextForkBoundary(
  config: ChainForkConfig,
  epoch: Epoch
): {currentBoundary: ForkBoundary; nextBoundary: ForkBoundary | undefined} {
  if (epoch < 0) {
    epoch = 0;
  }

  // NOTE: fork boundaries are sorted by ascending epoch
  const boundaries = config.forkBoundariesAscendingEpochOrder;
  let currentBoundaryIdx = -1;
  // findLastIndex
  for (let i = 0; i < boundaries.length; i++) {
    if (epoch >= boundaries[i].epoch) currentBoundaryIdx = i;
  }

  let nextBoundaryIdx = currentBoundaryIdx + 1;
  const hasNextBoundary = boundaries[nextBoundaryIdx] !== undefined && boundaries[nextBoundaryIdx].epoch !== Infinity;
  // Keep moving the needle of nextBoundaryIdx if there the higher boundary also exists on same epoch
  // for e.g. altair and bellatrix are on same epoch 6, next boundary should be bellatrix
  if (hasNextBoundary) {
    for (let i = nextBoundaryIdx + 1; i < boundaries.length; i++) {
      // If the boundary's epoch is same as nextBoundaryIdx (which is not equal to infinity),
      // update nextBoundaryIdx to the same
      if (boundaries[i].epoch === boundaries[nextBoundaryIdx].epoch) nextBoundaryIdx = i;
    }
  }

  return {
    currentBoundary: boundaries[currentBoundaryIdx] || boundaries[0],
    nextBoundary: hasNextBoundary ? boundaries[nextBoundaryIdx] : undefined,
  };
}
