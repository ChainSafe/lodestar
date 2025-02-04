import {ChainForkConfig} from "@lodestar/config";
import {MIN_EPOCHS_FOR_BLOCK_REQUESTS} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/interface.js";
import {Metrics} from "../../metrics/index.js";

/**
 * The maximum number of blocks to delete in a single batch
 *
 * Too much and the main thread will block
 */
// TODO tune these with metrics/data
const MAX_BLOCKS_TO_DELETE = 4096;

/**
 * The maximum number of states to delete in a single batch
 *
 * Too much and the main thread will block
 */
const MAX_STATES_TO_DELETE = 256;

export async function pruneHistory(
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch
): Promise<void> {
  // prune from 0 to cutoffEpoch, up to a limit (MAX_BLOCKS/STATES_TO_DELETE)
  const cutoffEpoch = Math.min(
    Math.max(currentEpoch - MIN_EPOCHS_FOR_BLOCK_REQUESTS, 0), // set by config, with underflow protection
    finalizedEpoch
  );
  const cutoffSlot = computeStartSlotAtEpoch(cutoffEpoch);

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    cutoffEpoch,
  });

  const step0 = metrics?.pruneHistory.fetchKeys.startTimer();
  const [blocks, states] = await Promise.all([
    db.blockArchive.keys({gte: 0, lte: cutoffSlot, limit: MAX_BLOCKS_TO_DELETE}),
    db.stateArchive.keys({gte: 0, lte: cutoffEpoch, limit: MAX_STATES_TO_DELETE}),
  ]);
  step0?.();

  logger.debug("Pruning history", {
    currentEpoch,
    blocksToPrune: blocks.length,
    statesToPrune: states.length,
  });

  const step1 = metrics?.pruneHistory.pruneKeys.startTimer();
  await Promise.all([
    // ->
    db.blockArchive.batchDelete(blocks),
    db.stateArchive.batchDelete(states),
  ]);
  step1?.();

  logger.debug("Pruned history", {
    currentEpoch,
  });

  metrics?.pruneHistory.pruneCount.inc();
}
