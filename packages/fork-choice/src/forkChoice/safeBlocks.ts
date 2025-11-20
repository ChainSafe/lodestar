import {ZERO_HASH_HEX} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Root, RootHex} from "@lodestar/types";
import {IForkChoice} from "./interface.js";

/**
 * Under honest majority and certain network synchronicity assumptions there exists a block
 * that is safe from re-orgs. Normally this block is pretty close to the head of canonical
 * chain which makes it valuable to expose a safe block to users.
 *
 * https://github.com/ethereum/consensus-specs/blob/master/fork_choice/safe-block.md#get_safe_beacon_block_root
 */
export function getSafeBeaconBlockRoot(fc: IForkChoice): Root {
  return fc.getJustifiedCheckpoint().root;
}

// https://github.com/ethereum/consensus-specs/blob/master/fork_choice/safe-block.md#get_safe_execution_block_hash
export function getSafeExecutionBlockHash(fc: IForkChoice): RootHex {
  const safeBlock = fc.getJustifiedBlock();
  const safeBlockEpoch = computeEpochAtSlot(safeBlock.slot);

  if (safeBlockEpoch >= fc.forkConfig.BELLATRIX_FORK_EPOCH) {
    /**
     * TODO: Ideally we should raise error if `executionPayloadBlockHash` is missing post bellatrix
     * but to keep current implementation intact commenting it for now
     *
     * if (!safeBlock.executionPayloadBlockHash) {
     *   throw new Error(`Safe block is expected to have execution payload block hash for epoch ${safeBlockEpoch}`);
     * }
     **/
    return safeBlock.executionPayloadBlockHash ?? ZERO_HASH_HEX;
  }

  return ZERO_HASH_HEX;
}
