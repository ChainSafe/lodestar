import {ForkName} from "@chainsafe/lodestar-params";
import {IChainForkConfig, IForkInfo} from "@chainsafe/lodestar-config";
import {Epoch} from "@chainsafe/lodestar-types";

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
 */
export const FORK_EPOCH_LOOKAHEAD = 2;

/**
 * Return the list of `ForkName`s meant to be active at `epoch`
 */
export function getActiveForks(config: IChainForkConfig, epoch: Epoch): ForkName[] {
  // Compute prev and next fork shifted, so next fork is still next at forkEpoch + FORK_EPOCH_LOOKAHEAD
  const activeForks: ForkName[] = [];
  // A sliding point to evaluate active forks with FORK_EPOCH_LOOKAHEAD windows
  let evalAtEpoch: Epoch | null = epoch - FORK_EPOCH_LOOKAHEAD - 1;
  do {
    const forks = getCurrentAndNextFork(config, evalAtEpoch);
    if (!forks.nextFork) {
      activeForks.push(forks.currentFork.name);
      evalAtEpoch = null;
    } else {
      const prevFork = forks.currentFork.name;
      const forkEpoch = forks.nextFork.epoch;

      // way before fork
      if (epoch < forkEpoch - FORK_EPOCH_LOOKAHEAD) {
        activeForks.push(prevFork);
        // No more need to slide and check, just exit
        evalAtEpoch = null;
      } else {
        if (epoch <= forkEpoch + FORK_EPOCH_LOOKAHEAD) {
          // The previous fork is relevant
          activeForks.push(prevFork);
        }

        if (epoch >= forkEpoch - FORK_EPOCH_LOOKAHEAD) {
          evalAtEpoch = forkEpoch;
        } else {
          evalAtEpoch = null;
        }
      }
    }
  } while (evalAtEpoch !== null);

  return activeForks;
}

/**
 * Return the currentFork and nextFork given a fork schedule and `epoch`
 */
export function getCurrentAndNextFork(
  config: IChainForkConfig,
  epoch: Epoch
): {currentFork: IForkInfo; nextFork: IForkInfo | undefined} {
  if (epoch < 0) epoch = 0;
  // NOTE: forks are sorted by ascending epoch, phase0 first
  const forks = Object.values(config.forks);
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
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    currentFork: forks[currentForkIdx] || forks[0],
    nextFork: hasNextFork ? forks[nextForkIdx] : undefined,
  };
}
