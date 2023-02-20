import {allForks} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {blockToHeader} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {fromHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../../../db/index.js";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";

export function toBeaconHeaderResponse(
  config: ChainForkConfig,
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
): Promise<{block: allForks.SignedBeaconBlock; executionOptimistic: boolean}> {
  const {block, executionOptimistic} = await resolveBlockIdOrNull(forkChoice, db, blockId);
  if (!block) {
    throw new ApiError(404, `No block found for id '${blockId}'`);
  }

  return {block, executionOptimistic};
}

async function resolveBlockIdOrNull(
  forkChoice: IForkChoice,
  db: IBeaconDb,
  blockId: routes.beacon.BlockId
): Promise<{block: allForks.SignedBeaconBlock | null; executionOptimistic: boolean}> {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    const head = forkChoice.getHead();
    return {
      block: await db.block.get(fromHexString(head.blockRoot)),
      executionOptimistic: isOptimisticBlock(head),
    };
  }

  if (blockId === "genesis") {
    return {
      block: await db.blockArchive.get(GENESIS_SLOT),
      executionOptimistic: false,
    };
  }

  if (blockId === "finalized") {
    return {
      block: await db.blockArchive.get(forkChoice.getFinalizedBlock().slot),
      executionOptimistic: false,
    };
  }

  let blockSummary;
  let getBlockByBlockArchive;

  if (blockId.startsWith("0x")) {
    const blockHash = fromHexString(blockId);
    blockSummary = forkChoice.getBlock(blockHash);
    getBlockByBlockArchive = async () => db.blockArchive.getByRoot(blockHash);
  } else {
    // block id must be slot
    const blockSlot = parseInt(blockId, 10);
    if (isNaN(blockSlot) && isNaN(blockSlot - 0)) {
      throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
    }
    blockSummary = forkChoice.getCanonicalBlockAtSlot(blockSlot);
    getBlockByBlockArchive = async () => db.blockArchive.get(blockSlot);
  }

  if (blockSummary) {
    // All unfinalized blocks **and the finalized block** are tracked by the fork choice.
    // Unfinalized blocks are stored in the block repository, but the finalized block is in the block archive
    const finalized = forkChoice.getFinalizedBlock();
    if (blockSummary.slot === finalized.slot) {
      return {
        block: await db.blockArchive.get(finalized.slot),
        executionOptimistic: isOptimisticBlock(blockSummary),
      };
    } else {
      return {
        block: await db.block.get(fromHexString(blockSummary.blockRoot)),
        executionOptimistic: false,
      };
    }
  } else {
    // Blocks not in the fork choice are in the block archive
    return {
      block: await getBlockByBlockArchive(),
      executionOptimistic: false,
    };
  }
}
