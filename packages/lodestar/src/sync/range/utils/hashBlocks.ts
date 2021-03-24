import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {byteArrayConcat} from "../../../util/bytes";

/**
 * Hash SignedBeaconBlock in a byte form easy to compare only
 * @param blocks
 * @param config
 */
export function hashBlocks(blocks: phase0.SignedBeaconBlock[], config: IBeaconConfig): Uint8Array {
  return byteArrayConcat(blocks.map((block) => config.types.phase0.SignedBeaconBlock.hashTreeRoot(block)));
}
