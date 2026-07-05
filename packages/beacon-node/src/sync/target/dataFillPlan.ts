import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostFulu, isForkPostGloas} from "@lodestar/params";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {isDaOutOfRange} from "../../chain/blocks/blockInput/utils.js";
import {HeaderChain} from "./types.js";

/**
 * Per-root fetch descriptor produced by `buildDataFillPlan`.
 *
 * `needsEnvelope` — the full signed execution-payload envelope must be fetched so the EL
 *   block can be imported.
 *
 * `needsColumns` — data-column sidecars (PeerDAS) must be fetched.  Only set when the block
 *   is FULL, has blobs, and its slot is within the DA availability window.
 *
 * The **top** element (the walk target) always has `needsEnvelope: false` — its payload
 * status comes from the seed / near-head path, not from this classifier.
 */
export type DataFillItem = {
  root: RootHex;
  slot: Slot;
  forkName: ForkName;
  /** gloas only: fetch the FULL block's signed execution-payload envelope by root. */
  needsEnvelope: boolean;
  /** fulu+: fetch the block's data-column sidecars (into the envelope for gloas, the block input otherwise). */
  needsColumns: boolean;
  blobCount: number;
};

/**
 * Classify every element of a `HeaderChain` into the set of data that must be
 * fetched before the block can be imported.
 *
 * The chain is bottom-first: `headerChain[0]` is the oldest block (whose parent is
 * already in fork-choice) and `headerChain[headerChain.length - 1]` is the target.
 *
 * TargetSync operates on fulu+ blocks. Data availability differs by fork:
 *   - gloas: the payload is revealed separately, so a FULL block needs its envelope
 *     (`needsEnvelope`) and, with blobs in-window, its columns (`needsColumns`).
 *   - fulu: the payload is inline; with blobs in-window the block needs its columns.
 *
 * `isFull` (a gloas FULL/EMPTY distinction) is only meaningful for gloas — fulu blocks always
 * carry their payload. The top element (no child) defers its payload status to the seed /
 * near-head path, so it is never `needsEnvelope`.
 */
export function buildDataFillPlan(
  config: ChainForkConfig,
  headerChain: HeaderChain,
  currentEpoch: Epoch
): DataFillItem[] {
  return headerChain.map((el, i) => {
    const child = headerChain[i + 1];
    const forkName = config.getForkName(el.slot);

    const isGloas = isForkPostGloas(forkName);
    const isFulu = isForkPostFulu(forkName);
    // The top element (no child) defers to the seed/near-head path.
    const isFull = child !== undefined && child.parentBlockHash === el.blockHash;
    const inWindow = !isDaOutOfRange(config, forkName, el.slot, currentEpoch);
    // Whether this block has data columns to fetch within the DA window.
    const hasData = el.blobCount > 0 && inWindow;

    return {
      root: el.root,
      slot: el.slot,
      forkName,
      needsEnvelope: isGloas && isFull,
      needsColumns: isFulu && (isGloas ? isFull && hasData : hasData),
      blobCount: el.blobCount,
    };
  });
}
