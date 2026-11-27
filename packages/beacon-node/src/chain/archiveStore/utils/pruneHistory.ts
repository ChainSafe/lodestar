import {ChainForkConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Logger, prettyPrintIndices} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {Metrics} from "../../../metrics/index.js";

/**
 * Bounds the blocks pruned per run, on startup and on every finalized checkpoint, so a large backlog is
 * drained over many runs instead of stalling one. The cutoff can be far ahead when pruning is first enabled
 * on an existing database, when the retention window shrinks at a fork or when finality resumes after a
 * long period of non-finality.
 */
export const MAX_PRUNE_BLOCK_SLOTS_PER_RUN = 4096;

// Genesis is kept so the block and state stay available via the API, e.g. for checkpoint providers
const FIRST_PRUNABLE_SLOT = GENESIS_SLOT + 1;

export async function pruneHistory(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch,
  statePruneFromSlot: Slot,
  beforePrune: (blockCutoffSlot: Slot) => Promise<void>,
  maxBlockSlots = Infinity
): Promise<{blockCutoffSlot: Slot; stateCutoffSlot: Slot}> {
  const blockCutoffEpoch = Math.min(
    // set by config, with underflow protection
    Math.max(currentEpoch - config.getMinEpochsForBlockRequests(currentEpoch), 0),
    // ensure that during (extremely lol) long periods of non-finality we don't delete unfinalized epoch data
    finalizedEpoch
  );
  const [firstBlockSlot = FIRST_PRUNABLE_SLOT] = await db.blockArchive.keys({gte: FIRST_PRUNABLE_SLOT, limit: 1});
  const blockCutoffSlot = Math.min(computeStartSlotAtEpoch(blockCutoffEpoch), firstBlockSlot + maxBlockSlots);
  // The latest archived state is the anchor on restart and can trail finalization by a few epochs
  const lastArchivedStateSlot = (await db.stateArchive.lastKey()) ?? 0;
  const stateCutoffSlot = Math.min(computeStartSlotAtEpoch(finalizedEpoch), lastArchivedStateSlot);
  const stateStartSlot = Math.max(statePruneFromSlot, FIRST_PRUNABLE_SLOT);

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    blockCutoffSlot,
    statePruneFromSlot,
    stateCutoffSlot,
  });

  const step0 = metrics?.pruneHistory.fetchKeys.startTimer();
  const [blocks, envelopes, states] = await Promise.all([
    db.blockArchive.keys({gte: FIRST_PRUNABLE_SLOT, lt: blockCutoffSlot}),
    db.executionPayloadEnvelopeArchive.keys({gte: FIRST_PRUNABLE_SLOT, lt: blockCutoffSlot}),
    stateCutoffSlot > stateStartSlot ? db.stateArchive.keys({gte: stateStartSlot, lt: stateCutoffSlot}) : [],
  ]);
  step0?.();

  logger.debug("Pruning history", {
    currentEpoch,
    blocksToPrune: blocks.length,
    envelopesToPrune: envelopes.length,
    statesToPrune: states.length,
    blockSlots: prettyPrintIndices(blocks),
    envelopeSlots: prettyPrintIndices(envelopes),
    stateSlots: prettyPrintIndices(states),
  });

  await beforePrune(blockCutoffSlot);

  const step1 = metrics?.pruneHistory.pruneKeys.startTimer();
  await Promise.all([
    // ->
    db.blockArchive.batchDeleteRange(blocks),
    db.executionPayloadEnvelopeArchive.batchDelete(envelopes),
    db.stateArchive.batchDelete(states),
  ]);
  step1?.();

  logger.debug("Pruned history", {
    currentEpoch,
  });

  metrics?.pruneHistory.pruneCount.inc();

  return {blockCutoffSlot, stateCutoffSlot};
}
