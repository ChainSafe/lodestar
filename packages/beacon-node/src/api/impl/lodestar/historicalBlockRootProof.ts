import {Tree} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {Root, Slot, ssz} from "@lodestar/types";

const EPOCHS_PER_HISTORICAL_ROOT = SLOTS_PER_HISTORICAL_ROOT / SLOTS_PER_EPOCH;

/**
 * Index into `state.historical_summaries` of the summary covering `period`. The list starts with the first
 * period whose summary was appended under Capella rules, which is the period containing CAPELLA_FORK_EPOCH:
 * the summary for the preceding period is appended by the epoch transition into the fork epoch, which still
 * runs pre-Capella and writes to `historical_roots`.
 */
export function getHistoricalSummaryIndex(config: ChainForkConfig, period: number): number {
  return period - Math.floor(config.CAPELLA_FORK_EPOCH / EPOCHS_PER_HISTORICAL_ROOT);
}

/**
 * Rebuilds `state.block_roots` as it was when the summary for the period starting at `periodStartSlot` was
 * taken. `process_slot` writes the latest block header root into every slot, so a skipped slot carries the
 * root of the latest block before it, and the first slot of the period may need the last root of the
 * previous period. Returns null when that root is needed but unknown.
 */
export function fillPeriodBlockRoots(
  periodStartSlot: Slot,
  rootBeforePeriod: Root | null,
  archived: {slot: Slot; root: Root}[]
): Root[] | null {
  const blockRoots: Root[] = [];
  let latest = rootBeforePeriod;
  let i = 0;
  for (let slot = periodStartSlot; slot < periodStartSlot + SLOTS_PER_HISTORICAL_ROOT; slot++) {
    if (i < archived.length && archived[i].slot === slot) {
      latest = archived[i].root;
      i++;
    }
    if (latest === null) {
      return null;
    }
    blockRoots.push(latest);
  }
  return blockRoots;
}

export function createBlockRootProof(
  blockRoots: Root[],
  index: number
): {blockRoot: Root; blockSummaryRoot: Root; proof: Uint8Array[]} {
  const view = ssz.phase0.HistoricalBlockRoots.toView(blockRoots);
  const {gindex} = ssz.phase0.HistoricalBlockRoots.getPathInfo([index]);
  return {
    blockRoot: blockRoots[index],
    blockSummaryRoot: view.hashTreeRoot(),
    proof: new Tree(view.node).getSingleProof(gindex),
  };
}
