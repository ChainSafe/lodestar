import {ZERO_HASH_HEX} from "@lodestar/params";
import {Root, RootHex} from "@lodestar/types";
import {IForkChoice} from "./interface.js";

/**
 * Under honest majority and certain network synchronicity assumptions there exists a block
 * that is safe from re-orgs. Normally this block is pretty close to the head of canonical
 * chain which makes it valuable to expose a safe block to users.
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0/fork_choice/safe-block.md#get_safe_beacon_block_root
 */
export function getSafeBeaconBlockRoot(fc: IForkChoice): Root {
  return fc.getJustifiedCheckpoint().root;
}

/**
 * Get execution payload hash for the safe block
 * This function assumes that safe block is post Bellatrix and function should not be called otherwise.
 *
 * As our existing usage is aligned with above condition so not adding fork-check inside this function
 *
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0/fork_choice/safe-block.md#get_safe_execution_block_hash
 */
export function getSafeExecutionBlockHash(forkChoice: IForkChoice): RootHex {
  return forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
}
