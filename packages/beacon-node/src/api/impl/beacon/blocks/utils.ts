import {routes} from "@lodestar/api";
import {blockToHeader} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {IForkChoice} from "@lodestar/fork-choice";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {IBeaconChain} from "../../../../chain/interface.js";
import {rootHexRegex} from "../../../../eth1/provider/utils.js";

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
    throw new ApiError(404, `No block found for id '${blockId}'`);
  }

  return res;
}
