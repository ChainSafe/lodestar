import {ChainConfig} from "@lodestar/config";
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
  config: ChainConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch,
  maxBlocksToDelete = MAX_BLOCKS_TO_DELETE,
  maxStatesToDelete = MAX_STATES_TO_DELETE
): Promise<void> {
  const blockCutoffEpoch = Math.min(
    // set by config, with underflow protection
    Math.max(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS, 0),
    // ensure that during (extremely lol) long periods of non-finality we don't delete unfinalized epoch data
    finalizedEpoch
  );
  const blockCutoffSlot = computeStartSlotAtEpoch(blockCutoffEpoch);

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    blockCutoffEpoch,
  });

  const step0 = metrics?.pruneHistory.fetchKeys.startTimer();
  const [blocks, states] = await Promise.all([
    db.blockArchive.keys({gte: 0, lt: blockCutoffSlot, limit: maxBlocksToDelete}),
    db.stateArchive.keys({gte: 0, lt: finalizedEpoch, limit: maxStatesToDelete}),
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
