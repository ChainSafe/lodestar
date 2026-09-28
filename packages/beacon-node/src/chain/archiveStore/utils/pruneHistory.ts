import {ChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Logger, prettyPrintIndices} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {Metrics} from "../../../metrics/index.js";

export async function pruneHistory(
  config: ChainConfig,
  db: IBeaconDb,
  logger: Logger,
  metrics: Metrics | null | undefined,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch
): Promise<Slot> {
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

  logger.debug("Preparing to prune history", {
    currentEpoch,
    finalizedEpoch,
    blockCutoffEpoch,
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
    blockSlots: prettyPrintIndices(blocks),
    envelopeSlots: prettyPrintIndices(envelopes),
    stateSlots: prettyPrintIndices(states),
  });

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

  return blockCutoffSlot;
}
