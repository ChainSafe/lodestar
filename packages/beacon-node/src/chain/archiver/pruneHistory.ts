import {ChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/interface.js";
import {Metrics} from "../../metrics/index.js";

export async function pruneHistory(
  config: ChainConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch
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
    db.blockArchive.keys({gte: 0, lt: blockCutoffSlot}),
    db.stateArchive.keys({gte: 0, lt: finalizedEpoch}),
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
