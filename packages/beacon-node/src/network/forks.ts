import {ChainForkConfig, SubscribeBoundary, isBlobSchedule} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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

export function getActiveSubscribeBoundaries(config: ChainForkConfig, epoch: Epoch): SubscribeBoundary[] {
  const activeBoundaries: SubscribeBoundary[] = [];
  const forkOrBlobScheduleList = config.forkOrBlobScheduleAscendingEpochOrder;

  for (let i = 0; i < forkOrBlobScheduleList.length; i++) {
    const currForkOrBlobSchedule = forkOrBlobScheduleList[i];
    const nextForkOrBlobSchedule = forkOrBlobScheduleList[i + 1];

    const currEpoch = isBlobSchedule(currForkOrBlobSchedule)
      ? currForkOrBlobSchedule.EPOCH
      : currForkOrBlobSchedule.epoch;
    const nextEpoch =
      nextForkOrBlobSchedule === undefined
        ? Infinity
        : isBlobSchedule(nextForkOrBlobSchedule)
          ? nextForkOrBlobSchedule.EPOCH
          : nextForkOrBlobSchedule.epoch;

    // Edge case: If multiple fork/blob schedule start at the same epoch, only consider the latest one
    if (currEpoch === nextEpoch) {
      continue;
    }

    if (epoch >= currEpoch - FORK_EPOCH_LOOKAHEAD && epoch <= nextEpoch + FORK_EPOCH_LOOKAHEAD) {
      activeBoundaries.push(config.getSubscribeBoundary(currEpoch));
    }
  }

  return activeBoundaries;
}

/**
 * Return the currentBoundary and nextBoundary given a fork/BPO schedule and `epoch`
 */
export function getCurrentAndNextBoundary(
  config: ChainForkConfig,
  epoch: Epoch
): {currentBoundary: SubscribeBoundary; nextBoundary?: SubscribeBoundary} {
  // normalize negative epochs to zero
  if (epoch < 0) epoch = 0;

  const schedule = config.forkOrBlobScheduleAscendingEpochOrder;
  let currIdx = -1;

  // find the last schedule whose start‐epoch ≤ our epoch
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const e = isBlobSchedule(entry) ? entry.EPOCH : entry.epoch;
    if (epoch >= e) currIdx = i;
  }

  // if we never found one, fall back to the very first
  if (currIdx === -1) currIdx = 0;

  const currSchedule = schedule[currIdx];
  const currEpoch = isBlobSchedule(currSchedule) ? currSchedule.EPOCH : currSchedule.epoch;
  const currentBoundary = config.getSubscribeBoundary(currEpoch);

  // find the next schedule whose epoch > our epoch
  let nextIdx = currIdx + 1;
  let entry = schedule[nextIdx];
  while (nextIdx < schedule.length && (isBlobSchedule(entry) ? entry.EPOCH : entry.epoch) === currEpoch) {
    // skip any that have the same epoch
    nextIdx++;
    entry = schedule[nextIdx];
  }

  if (nextIdx >= schedule.length) {
    return {currentBoundary, nextBoundary: undefined};
  }

  const nextSchedule = schedule[nextIdx];
  const nextEpoch = isBlobSchedule(nextSchedule) ? nextSchedule.EPOCH : nextSchedule.epoch;
  const nextBoundary = config.getSubscribeBoundary(nextEpoch);

  return {currentBoundary, nextBoundary};
}
