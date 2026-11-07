import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Logger, prettyPrintIndices} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {Metrics} from "../../../metrics/index.js";

// Genesis is kept so the block and state stay available via the API, e.g. for checkpoint providers
const FIRST_PRUNABLE_SLOT = GENESIS_SLOT + 1;

export async function pruneHistory(
  config: ChainConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch,
  statePruneFromSlot: Slot,
  beforePrune: (blockCutoffSlot: Slot) => Promise<void>
): Promise<{blockCutoffSlot: Slot; stateCutoffSlot: Slot}> {
  const blockCutoffEpoch = Math.min(
    // set by config, with underflow protection
    Math.max(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS, 0),
    // ensure that during (extremely lol) long periods of non-finality we don't delete unfinalized epoch data
    finalizedEpoch
  );
  const blockCutoffSlot = computeStartSlotAtEpoch(blockCutoffEpoch);
  // The latest archived state is the anchor on restart and can trail finalization by a few epochs
  const lastArchivedStateSlot = (await db.stateArchive.lastKey()) ?? 0;
  const stateCutoffSlot = Math.min(computeStartSlotAtEpoch(finalizedEpoch), lastArchivedStateSlot);
  const stateStartSlot = Math.max(statePruneFromSlot, FIRST_PRUNABLE_SLOT);

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    blockCutoffEpoch,
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
