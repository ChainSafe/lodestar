import {computeEpochAtSlot} from "@lodestar/state-transition";
import {FCRCache, FCRContext, FCRSnapshot, IFCRStore} from "./types.ts";
import {getBlockEpoch, getBlockSlot, getUnrealizedJustification} from "./utils.ts";

export function createFCRCache(): FCRCache {
  return {
    blockByRoot: new Map(),
    epochByRoot: new Map(),
    slotByRoot: new Map(),
    ancestorRoots: new Map(),
    committeeBySlot: new Map(),
    checkpointStateByKey: new Map(),
  };
}

export function buildFCRSnapshot(ctx: FCRContext, store: IFCRStore, cache: FCRCache): FCRSnapshot {
  const currentSlot = ctx.getCurrentSlot();
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const headRoot = ctx.getHead().blockRoot;
  const confirmedRoot = store.confirmedRoot;

  return {
    currentSlot,
    currentEpoch,
    headRoot,
    confirmedRoot,
    confirmedEpoch: getBlockEpoch(ctx, cache, confirmedRoot),
    confirmedSlot: getBlockSlot(ctx, cache, confirmedRoot),
    observedJustified: store.currentEpochObservedJustifiedCheckpoint,
    headUnrealized: getUnrealizedJustification(ctx, cache, headRoot),
    finalizedRoot: ctx.getFinalizedCheckpoint().rootHex,
  };
}
