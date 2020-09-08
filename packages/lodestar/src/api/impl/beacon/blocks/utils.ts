import {SignedBeaconBlock, SignedBeaconHeaderResponse} from "@chainsafe/lodestar-types";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {BlockId} from "./interface";
import {IBeaconDb} from "../../../../db/api";
import {GENESIS_SLOT} from "../../../../constants";
import {fromHexString} from "@chainsafe/ssz";

export function toBeaconHeaderResponse(
  config: IBeaconConfig,
  block: SignedBeaconBlock,
  canonical = false
): SignedBeaconHeaderResponse {
  return {
    root: config.types.BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature,
    },
  };
}

export async function resolveBlockId(
  config: IBeaconConfig,
  forkChoice: ForkChoice,
  db: IBeaconDb,
  blockId: BlockId
): Promise<SignedBeaconBlock | null> {
  blockId = blockId.toLowerCase();
  if (blockId === "head") {
    return db.block.get(forkChoice.getHeadRoot());
  }
  if (blockId === "genesis") {
    return db.blockArchive.get(GENESIS_SLOT);
  }
  if (blockId === "finalized") {
    return db.block.get(forkChoice.getFinalizedCheckpoint().root.valueOf() as Uint8Array);
  }
  if (blockId.startsWith("0x")) {
    const root = fromHexString(blockId);
    return (await db.block.get(root)) || (await db.blockArchive.getByRoot(root));
  }
  //block id must be slot
  const slot = parseInt(blockId, 10);
  if (isNaN(slot) && isNaN(slot - 0)) {
    throw new Error("Invalid block id");
  }
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return db.block.get(blockSummary.blockRoot);
  }
  return await db.blockArchive.get(slot);
}
