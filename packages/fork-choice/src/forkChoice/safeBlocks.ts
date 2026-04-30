import {ZERO_HASH_HEX} from "@lodestar/params";
import {Root, RootHex} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IForkChoice} from "./interface.js";

/**
 * Under honest majority and certain network synchronicity assumptions there exists a block
 * that is safe from re-orgs. Normally this block is pretty close to the head of canonical
 * chain which makes it valuable to expose a safe block to users.
 *
 * @deprecated The merged fast-confirmation spec only defines `get_safe_execution_block_hash`.
 */
export function getSafeBeaconBlockRoot(fc: IForkChoice): Root {
  const confirmedRoot = fc.getConfirmedRoot?.();
  if (confirmedRoot && fc.hasBlockHex(confirmedRoot)) {
    return fromHex(confirmedRoot);
  }
  return fc.getJustifiedCheckpoint().root;
}

/**
 * Get execution payload hash for the safe block
 *
 * https://github.com/ethereum/consensus-specs/blob/master/fork_choice/safe-block.md#get_safe_execution_block_hash
 */
export function getSafeExecutionBlockHash(forkChoice: IForkChoice): RootHex {
  const confirmedRoot = forkChoice.getConfirmedRoot?.();
  if (confirmedRoot) {
    const confirmedBlock = forkChoice.getBlockHexDefaultStatus(confirmedRoot);
    if (confirmedBlock?.executionPayloadBlockHash) {
      return confirmedBlock.executionPayloadBlockHash;
    }
  }
  return ZERO_HASH_HEX;
}
