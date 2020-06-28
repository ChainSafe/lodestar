import {Root, SignedBeaconBlock, SignedBeaconHeaderResponse} from "@chainsafe/lodestar-types";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILMDGHOST} from "../../../../chain/forkChoice";
import {BlockId} from "./interface";

export function toBeaconHeaderResponse(
  config: IBeaconConfig, block: SignedBeaconBlock, canonical= false
): SignedBeaconHeaderResponse {
  return {
    root: config.types.BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature
    }
  };
}

// this will need async once we wan't to resolve archive slot
export async function resolveBlockId(
  config: IBeaconConfig, forkChoice: ILMDGHOST, blockId: BlockId
): Promise<Root|null> {
  blockId = blockId.toLowerCase();
  if(blockId === "head") {
    return forkChoice.headBlockRoot();
  }
  if(blockId === "genesis") {
    blockId = "0";
  }
  if(blockId === "finalized") {
    return forkChoice.getFinalized().root;
  }
  if(blockId.startsWith("0x")) {
    return config.types.Root.fromJson(blockId);
  }
  //block id must be slot
  const slot = parseInt(blockId, 10);
  if(isNaN(slot) && isNaN(slot - 0)) {
    throw new Error("Invalid block id");
  }
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if(blockSummary) {
    return blockSummary.blockRoot;
  }
  //todo: resolve archive slot -> root

  return null;
}
