import {allForks, RootHex} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {toHex} from "@lodestar/utils";

/**
 * String to uniquely identify block segments. Used for peer scoring and to compare if batches are equivalent.
 */
export function hashBlocks(blocks: allForks.SignedBeaconBlock[], config: IChainForkConfig): RootHex {
  switch (blocks.length) {
    case 0:
      return "0x";
    case 1:
      return toHex(config.getForkTypes(blocks[0].message.slot).SignedBeaconBlock.hashTreeRoot(blocks[0]));
    default: {
      const block0 = blocks[0];
      const blockN = blocks[blocks.length - 1];
      return (
        toHex(config.getForkTypes(block0.message.slot).SignedBeaconBlock.hashTreeRoot(block0)) +
        toHex(config.getForkTypes(blockN.message.slot).SignedBeaconBlock.hashTreeRoot(blockN))
      );
    }
  }
}
