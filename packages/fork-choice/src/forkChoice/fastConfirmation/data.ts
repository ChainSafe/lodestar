import {computeEpochAtSlot} from "@lodestar/state-transition";
import {
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.ts";
import {getBlock, getUnrealizedJustification} from "./utils.ts";

export function createFastConfirmationCache(): FastConfirmationCache {
  return {
    blockByRoot: new Map(),
    ancestorRoots: new Map(),
    committeeBySlot: new Map(),
    isDescendantByRootPair: new Map(),
    voteWeightBySource: new Map(),
    checkpointStateByKey: new Map(),
  };
}

export function buildFastConfirmationSnapshot(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): FastConfirmationSnapshot {
  const currentSlot = ctx.getCurrentSlot();
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const headRoot = ctx.getHead().blockRoot;
  const confirmedRoot = store.confirmedRoot;
  const confirmedBlock = getBlock(ctx, cache, confirmedRoot);

  return {
    currentSlot,
    currentEpoch,
    headRoot,
    confirmedRoot,
    confirmedEpoch: confirmedBlock ? computeEpochAtSlot(confirmedBlock.slot) : null,
    confirmedSlot: confirmedBlock?.slot ?? null,
    observedJustified: store.currentEpochObservedJustifiedCheckpoint,
    headUnrealized: getUnrealizedJustification(ctx, cache, headRoot),
    finalizedRoot: ctx.getFinalizedCheckpoint().rootHex,
  };
}
