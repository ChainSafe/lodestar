import {ForkName, isForkPostFulu} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {BlobScheduleEntry} from "../chainConfig/index.js";
import {ForkConfig} from "../forkConfig/index.js";

export enum SubscribeBoundaryType {
  PreFulu,
  HardFork,
  BpoFork,
}
/**
 * Get the epoch of the boundary. We need this function because
 * 1) There is no epoch stored in boundary pre-fulu
 * 2) Post-fulu, `EPOCH` is not an accurate indicator of boundary's epoch. If a boundary refers
 *  to a hard fork, it is possible that its blob schedule's EPOCH still refers to the previous
 *  fork. But if a boundary refers to a BPO fork, then `EPOCH` is accurate
 */

/**
 * If boundary is a hard fork, we want to take fork epoch, and blob schedule's epoch will
 * only be less than or equal fork epoch. If boundary is BPO, we want to take blob schdule
 * epoch, and it will only be greater or equal to fork epoch. Either case we take max of
 * fork epoch and blob schedule epoch.
 */

type SubscribeBoundaryPreFulu = {
  readonly type: SubscribeBoundaryType.PreFulu;
  readonly fork: ForkName;
  readonly epoch: Epoch;
  readonly blobSchedule?: undefined;
};

type SubscribeBoundaryPostFulu = {
  readonly type: SubscribeBoundaryType.HardFork | SubscribeBoundaryType.BpoFork;
  readonly fork: ForkName;
  readonly epoch: Epoch;
  readonly blobSchedule: BlobScheduleEntry;
};

/**
 * Boundary of network subscription. We subscribe/unsubscribe during hard fork and bpo fork transitions.
 * There are 3 types of boundary:
 *  1) Pre-fulu hard fork - defined by hard fork name only
 *  2) Post-fulu bpo fork - defined by blob parameters (aka BlobScheduleEntry) and name of hard fork it is in
 *  3) Post-fulu hard fork - defined by hard fork's name, along with the blob parameters it should use
 *    (aka ForkConfig.getBlobParameters(*_FORK_EPOCH))
 *
 * TODO: We can actually make `type SubscribeBoundary = Epoch` and rely on the callers to decode it
 * as fork or blob schedule as needed. However it takes some sizable refactor give every callers access
 * to beacon config
 */
export type SubscribeBoundary = SubscribeBoundaryPreFulu | SubscribeBoundaryPostFulu;

export function createSubscribeBoundary(config: ForkConfig, epoch: Epoch): SubscribeBoundary {
  const fork = config.getForkInfoAtEpoch(epoch).name;
  const forkEpoch = config.forks[fork].epoch;

  if (isForkPostFulu(fork)) {
    const blobSchedule = config.getBlobParameters(epoch);
    const boundaryEpoch = Math.max(forkEpoch, blobSchedule.EPOCH);
    const type =
      boundaryEpoch === forkEpoch && forkEpoch !== blobSchedule.EPOCH
        ? SubscribeBoundaryType.HardFork
        : SubscribeBoundaryType.BpoFork;

    return {
      fork,
      epoch: boundaryEpoch,
      type,
      blobSchedule,
    };
  }
  return {
    fork,
    epoch: forkEpoch,
    type: SubscribeBoundaryType.PreFulu,
  };
}
