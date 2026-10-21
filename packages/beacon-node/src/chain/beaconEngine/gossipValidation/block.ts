import {ForkName, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {Root, SignedBeaconBlock, SubnetID, ssz} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {deserializeBlock} from "../../blocks/blockSerializedCache.js";
import {GossipActionError} from "../../errors/gossipValidation.js";
import {BlockErrorCode, BlockErrorType, BlockGossipError, GossipAction} from "../../errors/index.js";
import * as blobSidecarValidation from "../../validation/blobSidecar.js";
import * as blockValidation from "../../validation/block.js";
import {OpSource} from "../../validatorMonitor.js";
import type {BeaconEngineCore} from "../beaconEngineCore.js";
import {
  GossipValidationResult,
  GossipValidationStatus,
  fromResult,
  ignore,
  reject,
  runGossipValidation,
} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

export type GossipBlockResult = GossipValidationResult<blockValidation.GossipBlockValidationResult> & {
  blockErrorType?: BlockErrorType;
  /** Whether to process an eligible repeat proposal while retaining the IGNORE verdict. */
  shouldProcessRepeatProposalBlock: boolean;
};

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/block.ts#validateGossipBlock.
 * Handler source: unstable@2593063a82 packages/beacon-node/src/network/processor/gossipHandlers.ts#validateBeaconBlock.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#handleValidBeaconBlock.
 * [beacon-engine] deviation: validation/cache updates run in the engine; the facade retains block import.
 * // TODO - beacon engine: re-review this function
 */
export async function validateGossipBlock(
  this: BeaconEngineCore,
  isClosed: () => boolean,
  blockRoot: Root,
  blockBytes: Uint8Array,
  fork: ForkName,
  // API publication also call this with no seenTimestampSec
  seenTimestampSec?: number
): Promise<GossipBlockResult> {
  if (blockRoot.length !== 32) return {...reject("BLOCK_ROOT_MISMATCH"), shouldProcessRepeatProposalBlock: false};
  const blockRootHex = toRootHex(blockRoot);
  const payloadBlockRoot = isForkPostGloas(fork) ? blockRootHex : null;
  let signedBlock: SignedBeaconBlock | undefined;
  try {
    const {block} =
      seenTimestampSec === undefined
        ? deserializeBlock(this.config, blockRootHex, blockBytes, fork, this.serializedCache)
        : this.blockSerializedCache.getOrDeserialize(blockRootHex, blockBytes, fork);
    signedBlock = block;
    // Source: unstable@2593063a82 network/processor/gossipHandlers.ts#validateBeaconBlock.
    // [beacon-engine] Authenticate unknown-parent blocks before either owner's seen cache retains them.
    const result = await runGossipValidation(async () => {
      try {
        return await blockValidation.validateGossipBlock.call(this, block, fork);
      } catch (error) {
        if (
          error instanceof BlockGossipError &&
          (error.type.code === BlockErrorCode.PARENT_BLOCK_UNKNOWN ||
            error.type.code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN)
        ) {
          const {slot, proposerIndex} = block.message;
          await blockValidation.verifyBlockProposerSignature.call(this, block, blockRootHex);
          this.seenBlockProposers.observeBlockRoot(
            slot,
            proposerIndex,
            blockRootHex,
            signedBlockToSignedHeader(this.config, block)
          );
          if (this.seenBlockProposers.isKnown(slot, proposerIndex)) {
            if (this.seenBlockProposers.isRepeatProposal(slot, proposerIndex, blockRootHex)) {
              throw new BlockGossipError(GossipAction.IGNORE, {
                code: BlockErrorCode.REPEAT_PROPOSAL,
                proposerIndex,
                root: blockRootHex,
              });
            }
            throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRootHex});
          }
          this.seenBlockProposers.add(slot, proposerIndex, blockRootHex);
        }
        throw error;
      }
    });
    const shouldProcessRepeatProposalBlock =
      result.err?.status === GossipValidationStatus.Ignore &&
      result.err.code === BlockErrorCode.REPEAT_PROPOSAL &&
      this.seenBlockProposers.hasBlockRoot(block.message.slot, block.message.proposerIndex, blockRootHex) &&
      this.forkChoice.getBlockHexDefaultStatus(toRootHex(block.message.parentRoot)) !== null;
    const retained =
      result.err === null ||
      shouldProcessRepeatProposalBlock ||
      (result.err.status === GossipValidationStatus.Ignore &&
        (result.err.code === BlockErrorCode.PARENT_BLOCK_UNKNOWN ||
          result.err.code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN));
    if (retained) {
      if (payloadBlockRoot !== null) {
        this.seenPayloadEnvelopeInputCache.add({
          blockRootHex: payloadBlockRoot,
          block: block as SignedBeaconBlock<ForkPostGloas>,
          forkName: fork,
        });
      }
    } else if (seenTimestampSec !== undefined) {
      this.blockSerializedCache.delete(blockRootHex, block, "rejected");
    }
    if (this.validatorMonitor && seenTimestampSec !== undefined) {
      const {slot, proposerIndex} = block.message;
      const blockRoot = blockRootHex;
      const registerBlock = (): void => {
        if (isClosed()) return;
        try {
          this.validatorMonitor?.registerBeaconBlock(OpSource.gossip, this.clock.secFromSlot(slot, seenTimestampSec), {
            slot,
            proposerIndex,
            blockRoot,
          });
        } catch (e) {
          this.logger.debug("Error monitoring gossip block", {slot, root: blockRoot}, e as Error);
        }
      };
      // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#handleValidBeaconBlock.
      // [beacon-engine] deviation: accepted-block monitoring has its own deferred callback, preceding
      // the facade import handler. Observed siblings are still monitored before returning IGNORE.
      if (result.err === null) {
        callInNextEventLoop(registerBlock);
      } else if (shouldProcessRepeatProposalBlock) {
        registerBlock();
      }
    }
    return {
      ...result,
      blockErrorType: result.err?.error instanceof BlockGossipError ? result.err.error.type : undefined,
      shouldProcessRepeatProposalBlock,
    };
  } catch (error) {
    if (signedBlock !== undefined && seenTimestampSec !== undefined) {
      this.blockSerializedCache.delete(blockRootHex, signedBlock, "rejected");
    }
    if (
      error instanceof LodestarError &&
      (error.type.code === "INVALID_BLOCK_SSZ" || error.type.code === "BLOCK_ROOT_MISMATCH")
    ) {
      return {...reject(error.type.code, {blockRoot: blockRootHex}), shouldProcessRepeatProposalBlock: false};
    }
    // [beacon-engine] deviation: internal failures return a verdict without penalizing the peer.
    this.logger.error("Error validating gossip block", {root: blockRootHex, code: "UNEXPECTED_ERROR"}, error as Error);
    return {...ignore("UNEXPECTED_ERROR"), shouldProcessRepeatProposalBlock: false};
  } finally {
    // API publication shares this validator but does not initiate gossip equivocation processing.
    if (seenTimestampSec !== undefined && signedBlock !== undefined) {
      const {slot, proposerIndex} = signedBlock.message;
      if (this.seenBlockProposers.isEquivocating(slot, proposerIndex)) {
        this.processProposerEquivocation(slot, proposerIndex);
      }
    }
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blobSidecar.ts#validateGossipBlobSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export async function validateGossipBlobSidecar(
  this: BeaconEngineCore,
  blobBytes: Uint8Array,
  fork: ForkName,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    const blobSidecar = deserializeGossipMessage(ssz.deneb.BlobSidecar, blobBytes, this.serializedCache);
    return await runGossipValidation(() =>
      blobSidecarValidation.validateGossipBlobSidecar.call(this, fork, blobSidecar, subnet)
    );
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip blob sidecar", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}
