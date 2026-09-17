import {ChainForkConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {Metrics} from "../../../metrics/index.js";

/**
 * Bounds the blocks pruned per run on a running node. The cutoff can jump far ahead when the retention
 * window shrinks at a fork or when finality resumes after a long period of non-finality.
 */
export const MAX_PRUNE_BLOCK_SLOTS_PER_RUN = 4096;

export async function pruneHistory(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch,
  maxBlockSlots = Infinity
): Promise<void> {
  const blockCutoffEpoch = Math.min(
    // set by config, with underflow protection
    Math.max(currentEpoch - config.getMinEpochsForBlockRequests(currentEpoch), 0),
    // ensure that during (extremely lol) long periods of non-finality we don't delete unfinalized epoch data
    finalizedEpoch
  );
  const firstBlockSlot = (await db.blockArchive.firstKey()) ?? 0;
  const blockCutoffSlot = Math.min(computeStartSlotAtEpoch(blockCutoffEpoch), firstBlockSlot + maxBlockSlots);
  // The latest archived state is the anchor on restart and can trail finalization by a few epochs
  const lastArchivedStateSlot = (await db.stateArchive.lastKey()) ?? 0;
  const stateCutoffSlot = Math.min(computeStartSlotAtEpoch(finalizedEpoch), lastArchivedStateSlot);

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    blockCutoffSlot,
    stateCutoffSlot,
  });

  const step0 = metrics?.pruneHistory.fetchKeys.startTimer();
  const [blocks, envelopes, states] = await Promise.all([
    db.blockArchive.keys({gte: 0, lt: blockCutoffSlot}),
    db.executionPayloadEnvelopeArchive.keys({gte: 0, lt: blockCutoffSlot}),
    db.stateArchive.keys({gte: 0, lt: stateCutoffSlot}),
  ]);
  step0?.();

  logger.debug("Pruning history", {
    currentEpoch,
    blocksToPrune: blocks.length,
    envelopesToPrune: envelopes.length,
    statesToPrune: states.length,
  });

  const step1 = metrics?.pruneHistory.pruneKeys.startTimer();
  await Promise.all([
    // ->
    db.blockArchive.batchDelete(blocks),
    db.executionPayloadEnvelopeArchive.batchDelete(envelopes),
    db.stateArchive.batchDelete(states),
  ]);
  step1?.();

  logger.debug("Pruned history", {
    currentEpoch,
  });

  metrics?.pruneHistory.pruneCount.inc();
}
