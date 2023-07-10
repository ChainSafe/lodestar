import {allForks, isBlindedSignedBeaconBlock} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {blockToHeader} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {IBeaconChain} from "../../../../chain/interface.js";
import {rootHexRegex} from "../../../../eth1/provider/utils.js";

export function toBeaconHeaderResponse(
  config: ChainForkConfig,
  block: allForks.FullOrBlindedSignedBeaconBlock,
  canonical = false
): routes.beacon.BlockHeaderResponse {
  const root = isBlindedSignedBeaconBlock(block)
    ? config
        .getBlindedForkTypes(block.message.slot)
        .BeaconBlock.hashTreeRoot((block as allForks.SignedBlindedBeaconBlock).message)
    : config
        .getForkTypes((block as allForks.SignedBeaconBlock).message.slot)
        .BeaconBlock.hashTreeRoot((block as allForks.SignedBeaconBlock).message);

  return {
    root,
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature,
    },
  };
}

export async function resolveBlockId(
  chain: IBeaconChain,
  blockId: routes.beacon.BlockId
): Promise<{block: allForks.SignedBeaconBlock; executionOptimistic: boolean}> {
  const res = await resolveBlockIdOrNull(chain, blockId);
  if (!res) {
    throw new ApiError(404, `No block found for id '${blockId}'`);
  }

  return res;
}

async function resolveBlockIdOrNull(
  chain: IBeaconChain,
  blockId: routes.beacon.BlockId
): Promise<{block: allForks.SignedBeaconBlock; executionOptimistic: boolean} | null> {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    return chain.getBlockByRoot(chain.forkChoice.getHead().blockRoot);
  }

  if (blockId === "genesis") {
    return chain.getCanonicalBlockAtSlot(GENESIS_SLOT);
  }

  if (blockId === "finalized") {
    return chain.getCanonicalBlockAtSlot(chain.forkChoice.getFinalizedBlock().slot);
  }

  if (blockId === "justified") {
    return chain.getBlockByRoot(chain.forkChoice.getJustifiedBlock().blockRoot);
  }

  if (blockId.startsWith("0x")) {
    if (!rootHexRegex.test(blockId)) {
      throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
    }
    return chain.getBlockByRoot(blockId);
  }

  // block id must be slot
  const blockSlot = parseInt(blockId, 10);
  if (isNaN(blockSlot) && isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
  }
  return chain.getCanonicalBlockAtSlot(blockSlot);
}
