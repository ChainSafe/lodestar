import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {byteArrayConcat} from "../../../util/bytes";

/**
 * Hash SignedBeaconBlock in a byte form easy to compare only
 * @param blocks
 * @param config
 */
export function hashBlocks(blocks: allForks.SignedBeaconBlock[], config: IBeaconConfig): Uint8Array {
  return byteArrayConcat(
    blocks.map((block) => config.getTypes(block.message.slot).SignedBeaconBlock.hashTreeRoot(block))
  );
}
