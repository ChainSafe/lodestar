import {ChainForkConfig} from "@lodestar/config";
import {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../../../chain/blocks/blockInput/types.js";

/**
 * String to uniquely identify block segments. Used for peer scoring and to compare if batches are equivalent.
 */
export function hashBlocks(blocks: IBlockInput[], config: ChainForkConfig): RootHex {
  switch (blocks.length) {
    case 0:
      return "0x";
    case 1: {
      const block0 = blocks[0].getBlock();
      return toRootHex(config.getForkTypes(block0.message.slot).SignedBeaconBlock.hashTreeRoot(block0));
    }
    default: {
      const block0 = blocks[0].getBlock();
      const blockN = blocks.at(-1)?.getBlock() as SignedBeaconBlock;
      return (
        // TODO(fulu): should we be doing checks for presence to make sure these do not blow up?
        toRootHex(config.getForkTypes(block0.message.slot).SignedBeaconBlock.hashTreeRoot(block0)) +
        toRootHex(config.getForkTypes(blockN.message.slot).SignedBeaconBlock.hashTreeRoot(blockN))
      );
    }
  }
}
