import {GENESIS_SLOT, ZERO_HASH_HEX} from "@lodestar/params";
import {Root, RootHex} from "@lodestar/types";
import {LogLevel, Logger, fromHex} from "@lodestar/utils";
import {HEX_ZERO_HASH, ProtoBlock, isGloasBlock} from "../protoArray/interface.js";
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
 * Get execution payload hash to report as `safeBlockHash` in `engine_forkchoiceUpdated`.
 *
 * Pre-Gloas: the confirmed block's own payload hash.
 * Post-Gloas: the confirmed block's bid `parent_block_hash` — under ePBS the block's own
 * payload may not yet be confirmed canonical, so we report the parent EL block which has
 * been (the bid commits to extending it).
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/bellatrix/fast-confirmation.md#new-get_safe_execution_block_hash
 */
export function getSafeExecutionBlockHash(forkChoice: IForkChoice, logger?: Pick<Logger, LogLevel.warn>): RootHex {
  const confirmedBlock = forkChoice.getConfirmedBlock();
  if (confirmedBlock === null) {
    logger?.warn("Confirmed block not found, using zero safe execution block hash", {
      confirmedRoot: forkChoice.getConfirmedRoot(),
    });
    return ZERO_HASH_HEX;
  }

  return getExecutionBlockHash(confirmedBlock, logger);
}

/**
 * Get execution payload hash to report as `finalizedBlockHash` in `engine_forkchoiceUpdated`.
 * Mirrors `getSafeExecutionBlockHash`: post-Gloas returns the bid `parent_block_hash`.
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/gloas/fork-choice.md#notify_forkchoice_updated
 */
export function getFinalizedExecutionBlockHash(forkChoice: IForkChoice, logger?: Pick<Logger, LogLevel.warn>): RootHex {
  return getExecutionBlockHash(forkChoice.getFinalizedBlock(), logger);
}

function getExecutionBlockHash(block: ProtoBlock, logger?: Pick<Logger, LogLevel.warn>): RootHex {
  if (isGloasBlock(block)) {
    return block.parentBlockHash;
  }

  // The genesis block body carries a default execution payload, so it is not an execution block
  // per the spec (`is_execution_block`); its proto-array payload hash comes from the anchor
  // state header instead of a block body and must not be reported as safe.
  if (block.slot === GENESIS_SLOT) {
    return HEX_ZERO_HASH;
  }

  if (block.executionPayloadBlockHash === null) {
    logger?.warn("Execution payload block hash not found, using zero hash", {
      blockRoot: block.blockRoot,
      slot: block.slot,
    });
    return HEX_ZERO_HASH;
  }

  return block.executionPayloadBlockHash;
}
