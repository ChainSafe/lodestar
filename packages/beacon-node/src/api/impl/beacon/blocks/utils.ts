import {routes} from "@lodestar/api";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IChainView} from "../../../../chain/chainView/interface.js";
import {IBeaconChain} from "../../../../chain/interface.js";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {rootHexRegex} from "../../../../execution/engine/utils.js";
import {ApiError, ValidationError} from "../../errors.js";

export function resolveBlockId(chainView: IChainView, blockId: routes.beacon.BlockId): RootHex | Slot {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    return chainView.getHead().blockRoot;
  }

  if (blockId === "genesis") {
    return GENESIS_SLOT;
  }

  if (blockId === "finalized") {
    return chainView.getFinalizedBlock().blockRoot;
  }

  if (blockId === "justified") {
    return chainView.getJustifiedBlock().blockRoot;
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
  const rootOrSlot = resolveBlockId(chain, blockId);

  const res =
    typeof rootOrSlot === "string"
      ? await chain.beaconEngine.getBlockByRoot(fromHex(rootOrSlot))
      : await chain.beaconEngine.getCanonicalBlockAtSlot(rootOrSlot);

  if (!res) {
    throw new ApiError(404, `Block not found for id '${blockId}'`);
  }

  return res;
}
