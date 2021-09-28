import {allForks} from "@chainsafe/lodestar-types";
import {routes} from "@chainsafe/lodestar-api";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconDb} from "../../../../db";
import {GENESIS_SLOT} from "../../../../constants";
import {fromHexString} from "@chainsafe/ssz";
import {ApiError, ValidationError} from "../../errors";

export function toBeaconHeaderResponse(
  config: IChainForkConfig,
  block: allForks.SignedBeaconBlock,
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

export async function resolveBlockId(
  forkChoice: IForkChoice,
  db: IBeaconDb,
  blockId: routes.beacon.BlockId
): Promise<allForks.SignedBeaconBlock> {
  const block = await resolveBlockIdOrNull(forkChoice, db, blockId);
  if (!block) {
    throw new ApiError(404, `No block found for id '${blockId}'`);
  }

  return block;
}

async function resolveBlockIdOrNull(
  forkChoice: IForkChoice,
  db: IBeaconDb,
  blockId: routes.beacon.BlockId
): Promise<allForks.SignedBeaconBlock | null> {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    const head = forkChoice.getHead();
    return db.block.get(fromHexString(head.blockRoot));
  }

  if (blockId === "genesis") {
    return db.blockArchive.get(GENESIS_SLOT);
  }

  if (blockId === "finalized") {
    return await db.blockArchive.get(forkChoice.getFinalizedBlock().slot);
  }

  let blockSummary;
  let getBlockByBlockArchive;

  if (blockId.startsWith("0x")) {
    const blockHash = fromHexString(blockId);
    blockSummary = forkChoice.getBlock(blockHash);
    getBlockByBlockArchive = async () => await db.blockArchive.getByRoot(blockHash);
  } else {
    // block id must be slot
    const blockSlot = parseInt(blockId, 10);
    if (isNaN(blockSlot) && isNaN(blockSlot - 0)) {
      throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
    }
    blockSummary = forkChoice.getCanonicalBlockAtSlot(blockSlot);
    getBlockByBlockArchive = async () => await db.blockArchive.get(blockSlot);
  }

  if (blockSummary) {
    // All unfinalized blocks **and the finalized block** are tracked by the fork choice.
    // Unfinalized blocks are stored in the block repository, but the finalized block is in the block archive
    const finalized = forkChoice.getFinalizedBlock();
    if (blockSummary.slot === finalized.slot) {
      return await db.blockArchive.get(finalized.slot);
    } else {
      return await db.block.get(fromHexString(blockSummary.blockRoot));
    }
  } else {
    // Blocks not in the fork choice are in the block archive
    return await getBlockByBlockArchive();
  }
}
