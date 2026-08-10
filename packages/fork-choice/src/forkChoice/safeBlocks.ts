import {GENESIS_SLOT} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {LogLevel, Logger} from "@lodestar/utils";
import {ExecutionStatus, HEX_ZERO_HASH, ProtoBlock, isGloasBlock} from "../protoArray/interface.js";
import {ForkChoiceError, ForkChoiceErrorCode} from "./errors.js";
import {IForkChoice} from "./interface.js";

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
export function getSafeExecutionBlockHash(forkChoice: IForkChoice, logger?: Pick<Logger, LogLevel.debug>): RootHex {
  const confirmedRoot = forkChoice.getConfirmedRoot();
  const confirmedBlock = forkChoice.getConfirmedBlock();
  if (confirmedBlock === null) {
    throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: confirmedRoot});
  }

  if (confirmedBlock.blockRoot === forkChoice.getFinalizedBlock().blockRoot) {
    logger?.debug("Confirmed block is the finalized block", {
      blockRoot: confirmedBlock.blockRoot,
      slot: confirmedBlock.slot,
    });
  }

  return getExecutionBlockHash(confirmedBlock);
}

/**
 * Get execution payload hash to report as `finalizedBlockHash` in `engine_forkchoiceUpdated`.
 * Mirrors `getSafeExecutionBlockHash`: post-Gloas returns the bid `parent_block_hash`.
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/gloas/fork-choice.md#notify_forkchoice_updated
 */
export function getFinalizedExecutionBlockHash(forkChoice: IForkChoice): RootHex {
  return getExecutionBlockHash(forkChoice.getFinalizedBlock());
}

function getExecutionBlockHash(block: ProtoBlock): RootHex {
  if (isGloasBlock(block)) {
    return block.parentBlockHash;
  }

  // The genesis block body carries a default execution payload, so it is not an execution block
  // per the spec (`is_execution_block`); its proto-array payload hash comes from the anchor
  // state header instead of a block body and must not be reported as safe.
  if (block.slot === GENESIS_SLOT) {
    return HEX_ZERO_HASH;
  }

  // Widen the correlated fields so the runtime invariant is still checked for malformed input.
  const executionPayloadBlockHash: RootHex | null = block.executionPayloadBlockHash;
  const executionStatus: ExecutionStatus = block.executionStatus;
  if (executionPayloadBlockHash === null) {
    if (executionStatus !== ExecutionStatus.PreMerge) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_EXECUTION_PAYLOAD_BLOCK_HASH,
        root: block.blockRoot,
        slot: block.slot,
      });
    }
    return HEX_ZERO_HASH;
  }

  return executionPayloadBlockHash;
}
