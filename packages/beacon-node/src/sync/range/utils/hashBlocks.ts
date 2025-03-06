import {ChainForkConfig} from "@lodestar/config";
import {RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInput} from "../../../chain/blocks/utils/blockInput.js";

/**
 * String to uniquely identify block segments. Used for peer scoring and to compare if batches are equivalent.
 */
export function hashBlocks(blocks: BlockInput[]): string {
  switch (blocks.length) {
    case 0:
      return "0x";
    case 1: {
      return blocks[0].rootHex;
    }
    default: {
      return blocks[0].rootHex + blocks[blocks.length - 1].rootHex;
    }
  }
}
