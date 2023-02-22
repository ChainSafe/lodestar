import {RootHex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {toHex} from "@lodestar/utils";
import {BlockInput} from "../../../chain/blocks/types.js";

/**
 * String to uniquely identify block segments. Used for peer scoring and to compare if batches are equivalent.
 */
export function hashBlocks(blocks: BlockInput[], config: ChainForkConfig): RootHex {
  switch (blocks.length) {
    case 0:
      return "0x";
    case 1: {
      const block0 = blocks[0].block;
      return toHex(config.getForkTypes(block0.message.slot).SignedBeaconBlock.hashTreeRoot(block0));
    }
    default: {
      const block0 = blocks[0].block;
      const blockN = blocks[blocks.length - 1].block;
      return (
        toHex(config.getForkTypes(block0.message.slot).SignedBeaconBlock.hashTreeRoot(block0)) +
        toHex(config.getForkTypes(blockN.message.slot).SignedBeaconBlock.hashTreeRoot(blockN))
      );
    }
  }
}
