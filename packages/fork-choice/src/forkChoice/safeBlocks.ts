import {ZERO_HASH_HEX} from "@lodestar/params";
import {Root, RootHex} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import type {ProtoBlock} from "../protoArray/interface.js";
import {IForkChoice} from "./interface.js";

/**
 * Under honest majority and certain network synchronicity assumptions there exists a block
 * that is safe from re-orgs. Normally this block is pretty close to the head of canonical
 * chain which makes it valuable to expose a safe block to users.
 *
 * @deprecated The merged fast-confirmation spec only defines `get_safe_execution_block_hash`.
 */
export function getSafeBeaconBlockRoot(fc: IForkChoice): Root {
  const confirmedRoot = fc.getConfirmedRoot();
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
  const confirmedRoot = forkChoice.getConfirmedRoot();
  if (confirmedRoot) {
    const confirmedBlock = forkChoice.getBlockHexDefaultStatus(confirmedRoot);
    if (confirmedBlock?.executionPayloadBlockHash) {
      return confirmedBlock.executionPayloadBlockHash;
    }
  }
  return ZERO_HASH_HEX;
}

/**
 * Get a safe execution payload hash compatible with a specific FCU head.
 *
 * `safeBlockHash` must be equal to or an ancestor of `headBlockHash`. During
 * proposer-head reorg production the selected head can intentionally be an
 * ancestor of fork choice's current/confirmed head, so the global safe block may
 * no longer belong to the chain defined by the FCU head.
 */
export function getSafeExecutionBlockHashForHead(forkChoice: IForkChoice, headBlock: ProtoBlock): RootHex {
  const confirmedRoot = forkChoice.getConfirmedRoot();
  if (!confirmedRoot) {
    return ZERO_HASH_HEX;
  }

  const confirmedBlock = forkChoice.getBlockHexDefaultStatus(confirmedRoot);
  if (!confirmedBlock?.executionPayloadBlockHash) {
    return ZERO_HASH_HEX;
  }

  if (
    forkChoice.isDescendant(
      confirmedBlock.blockRoot,
      confirmedBlock.payloadStatus,
      headBlock.blockRoot,
      headBlock.payloadStatus
    )
  ) {
    return confirmedBlock.executionPayloadBlockHash;
  }

  return ZERO_HASH_HEX;
}
