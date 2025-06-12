import {BlobScheduleEntry, ChainForkConfig, ForkInfo} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {SubscribeBoundary} from "./core/types.js";

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
 * Return the list of `ForkName`s meant to be active at `epoch`
 * @see FORK_EPOCH_LOOKAHEAD for details on when forks are considered 'active'
 */
export function getActiveForks(config: ChainForkConfig, epoch: Epoch): ForkName[] {
  const activeForks: ForkName[] = [];
  const forks = config.forksAscendingEpochOrder;

  for (let i = 0; i < forks.length; i++) {
    const currForkEpoch = forks[i].epoch;
    const nextForkEpoch = i >= forks.length - 1 ? Infinity : forks[i + 1].epoch;

    // Edge case: If multiple forks start at the same epoch, only consider the latest one
    if (currForkEpoch === nextForkEpoch) {
      continue;
    }

    if (epoch >= currForkEpoch - FORK_EPOCH_LOOKAHEAD && epoch <= nextForkEpoch + FORK_EPOCH_LOOKAHEAD) {
      activeForks.push(forks[i].name);
    }
  }

  return activeForks;
}

function getActiveBlobSchedule(config: ChainForkConfig, epoch: Epoch): BlobScheduleEntry[] {
  const activeBlobSchedule = new Set<BlobScheduleEntry>();

  for (let i = epoch - FORK_EPOCH_LOOKAHEAD; i <= epoch + FORK_EPOCH_LOOKAHEAD; i++) {
    const blobSchedule = config.getBlobParameters(i);
    if (blobSchedule !== null) {
      activeBlobSchedule.add(blobSchedule);
    }
  }

  return [...activeBlobSchedule];
}

export function getActiveSubscribeBoundaries(config: ChainForkConfig, epoch: Epoch): SubscribeBoundary[] {
  const activeForks = getActiveForks(config, epoch);
  const activeBlobSchedule = getActiveBlobSchedule(config, epoch);

  // If we have completely entered blob schedule stage, use activeBlobSchedule
  if (config.getBlobParameters(epoch - FORK_EPOCH_LOOKAHEAD) !== null) {
    return activeBlobSchedule.map((entry) => ({...entry, fork: config.getForkInfoAtEpoch(entry.EPOCH).name}));
  }

  // If we have not entered at least the first blob schedule, use activeForks
  if (config.getBlobParameters(epoch + FORK_EPOCH_LOOKAHEAD) === null) {
    return activeForks.map((fork) => ({fork}));
  }

  // If we are partially entering first blob schedule, usually we use both
  // TODO: There is an unhandled corner case where first blob schedule collides with fork boundary
  // in that case, we will subscribe to wrong topics in additional to the correct topics for
  // maximum of FORK_EPOCH_LOOKAHEAD * 2 epochs.
  return [
    ...activeForks.map((fork) => ({fork})),
    ...activeBlobSchedule.map((entry) => ({...entry, fork: config.getForkInfoAtEpoch(entry.EPOCH).name})),
  ];
}

/**
 * Return the currentFork and nextFork given a fork schedule and `epoch`
 */
export function getCurrentAndNextFork(
  config: ChainForkConfig,
  epoch: Epoch
): {currentFork: ForkInfo; nextFork: ForkInfo | undefined} {
  if (epoch < 0) {
    epoch = 0;
  }

  // NOTE: forks are sorted by ascending epoch, phase0 first
  const forks = config.forksAscendingEpochOrder;
  let currentForkIdx = -1;
  // findLastIndex
  for (let i = 0; i < forks.length; i++) {
    if (epoch >= forks[i].epoch) currentForkIdx = i;
  }

  let nextForkIdx = currentForkIdx + 1;
  const hasNextFork = forks[nextForkIdx] !== undefined && forks[nextForkIdx].epoch !== Infinity;
  // Keep moving the needle of nextForkIdx if there the higher fork also exists on same epoch
  // for e.g. altair and bellatrix are on same epoch 6, next fork should be bellatrix
  if (hasNextFork) {
    for (let i = nextForkIdx + 1; i < forks.length; i++) {
      // If the fork's epoch is same as nextForkIdx (which is not equal to infinity),
      // update nextForkIdx to the same
      if (forks[i].epoch === forks[nextForkIdx].epoch) nextForkIdx = i;
    }
  }

  return {
    currentFork: forks[currentForkIdx] || forks[0],
    nextFork: hasNextFork ? forks[nextForkIdx] : undefined,
  };
}
