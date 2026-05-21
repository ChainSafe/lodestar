import {Root, RootHex} from "@lodestar/types";
import {HEX_ZERO_HASH, ProtoBlock, isGloasBlock} from "../protoArray/interface.js";
import {IForkChoice} from "./interface.js";

/**
 * Under honest majority and certain network synchronicity assumptions there exists a block
 * that is safe from re-orgs. Normally this block is pretty close to the head of canonical
 * chain which makes it valuable to expose a safe block to users.
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/fork_choice/safe-block.md#get_safe_beacon_block_root
 */
export function getSafeBeaconBlockRoot(fc: IForkChoice): Root {
  return fc.getJustifiedCheckpoint().root;
}

/**
 * Get execution payload hash to report as `safeBlockHash` in `engine_forkchoiceUpdated`.
 *
 * Pre-Gloas: the justified block's own payload hash.
 * Post-Gloas: the justified block's bid `parent_block_hash` — under ePBS the block's own
 * payload may not yet be confirmed canonical, so we report the parent EL block which has
 * been (the bid commits to extending it).
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/fork_choice/safe-block.md#get_safe_execution_block_hash
 */
export function getSafeExecutionBlockHash(forkChoice: IForkChoice): RootHex {
  return getExecutionBlockHashForFCU(forkChoice.getJustifiedBlock());
}

/**
 * Get execution payload hash to report as `finalizedBlockHash` in `engine_forkchoiceUpdated`.
 * Mirrors `getSafeExecutionBlockHash`: post-Gloas returns the bid `parent_block_hash`.
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/specs/gloas/fork-choice.md#modified-notify_forkchoice_updated
 */
export function getFinalizedExecutionBlockHash(forkChoice: IForkChoice): RootHex {
  return getExecutionBlockHashForFCU(forkChoice.getFinalizedBlock());
}

function getExecutionBlockHashForFCU(block: ProtoBlock): RootHex {
  if (isGloasBlock(block)) {
    return block.parentBlockHash as RootHex;
  }
  return block.executionPayloadBlockHash ?? HEX_ZERO_HASH;
}
