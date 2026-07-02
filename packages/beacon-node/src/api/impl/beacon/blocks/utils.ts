import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {blockToHeader} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {IBeaconChain} from "../../../../chain/interface.js";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {rootHexRegex} from "../../../../execution/engine/utils.js";
import {ApiError, ValidationError} from "../../errors.js";

export function toBeaconHeaderResponse(
  config: ChainForkConfig,
  block: SignedBeaconBlock,
  canonical = false
): routes.beacon.BlockHeaderResponse {
  return {
    root: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature,
    },
  };
}

export function resolveBlockId(forkChoice: IForkChoice, blockId: routes.beacon.BlockId): RootHex | Slot {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    return forkChoice.getHead().blockRoot;
  }

  if (blockId === "genesis") {
    return GENESIS_SLOT;
  }

  if (blockId === "finalized") {
    return forkChoice.getFinalizedBlock().blockRoot;
  }

  if (blockId === "justified") {
    return forkChoice.getJustifiedBlock().blockRoot;
  }

  if (blockId.startsWith("0x")) {
    if (!rootHexRegex.test(blockId)) {
      throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
    }
    return blockId;
  }

  // block id must be slot
  const blockSlot = parseInt(blockId, 10);
  if (Number.isNaN(blockSlot) && Number.isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
  }
  return blockSlot;
}

/**
 * Count data columns that were published to zero peers AND were newly introduced to the network by us.
 *
 * When self-building post-gloas, the block is published first, then peers fetch the blobs from their EL
 * and disseminate the columns via gossip before we publish the execution payload envelope. Those columns
 * can therefore already be in our seen cache by the time we publish them, in which case our publish is a
 * no-op duplicate that resolves to zero recipients — expected, not a propagation failure. Only columns we
 * actually introduced to the network (not already present) should count towards the zero-peers warning.
 *
 * See https://github.com/ChainSafe/lodestar/issues/9527.
 *
 * @param sentPeersPerColumn number of peers each column was published to, aligned with `columnAlreadyPresent`
 * @param columnAlreadyPresent whether each column was already in our seen cache before we published it
 */
export function countColumnsPublishedWithZeroPeers(
  sentPeersPerColumn: number[],
  columnAlreadyPresent: boolean[]
): number {
  let count = 0;
  for (let i = 0; i < sentPeersPerColumn.length; i++) {
    if (sentPeersPerColumn[i] === 0 && !columnAlreadyPresent[i]) {
      count++;
    }
  }
  return count;
}

export async function getBlockResponse(
  chain: IBeaconChain,
  blockId: routes.beacon.BlockId
): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean}> {
  const rootOrSlot = resolveBlockId(chain.forkChoice, blockId);

  const res =
    typeof rootOrSlot === "string"
      ? await chain.getBlockByRoot(rootOrSlot)
      : await chain.getCanonicalBlockAtSlot(rootOrSlot);

  if (!res) {
    throw new ApiError(404, `Block not found for id '${blockId}'`);
  }

  return res;
}
