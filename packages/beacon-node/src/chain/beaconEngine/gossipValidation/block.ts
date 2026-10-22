import {ForkName, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, SubnetID, WithBytes, deneb, ssz} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {deserializeBlock} from "../../blocks/blockSerializedCache.js";
import {SignedBlockRoot, SignedBlockRootHex, toSignedBlockRootHex} from "../../blocks/signedBlockRoot.js";
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
export async function validateGossipBlockBytes(
  this: BeaconEngineCore,
  signedBlockRoot: SignedBlockRoot,
  blockBytes: Uint8Array,
  fork: ForkName,
  // API publication also calls this with no seenTimestampSec.
  seenTimestampSec?: number
): Promise<GossipBlockResult> {
  if (signedBlockRoot.length !== 32)
    return {...reject("SIGNED_BLOCK_ROOT_MISMATCH"), shouldProcessRepeatProposalBlock: false};
  const signedBlockRootHex = toSignedBlockRootHex(signedBlockRoot);
  try {
    const {block} =
      seenTimestampSec === undefined
        ? deserializeBlock(this.config, signedBlockRoot, blockBytes, fork)
        : this.blockSerializedCache.getOrDeserialize(signedBlockRoot, blockBytes, fork);
    return doValidateGossipBlock.call(this, signedBlockRootHex, block, fork, seenTimestampSec);
  } catch (error) {
    return gossipBlockError.call(this, error, signedBlockRootHex);
  }
}

export async function validateGossipBlock(
  this: BeaconEngineCore,
  {data: block}: WithBytes<SignedBeaconBlock>,
  fork: ForkName,
  seenTimestampSec?: number
): Promise<GossipBlockResult> {
  return doValidateGossipBlock.call(this, undefined, block, fork, seenTimestampSec);
}

async function doValidateGossipBlock(
  this: BeaconEngineCore,
  // Object entrypoints must leave this undefined so neither verdict nor error cleanup touches blockSerializedCache.
  signedBlockRootHex: SignedBlockRootHex | undefined,
  block: SignedBeaconBlock,
  fork: ForkName,
  seenTimestampSec?: number
): Promise<GossipBlockResult> {
  let blockRootForLog: RootHex | undefined;
  try {
    const blockRootHex = toRootHex(
      this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)
    );
    blockRootForLog = blockRootHex;
    const payloadBlockRoot = isForkPostGloas(fork) ? blockRootHex : null;
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
    } else if (signedBlockRootHex !== undefined && seenTimestampSec !== undefined) {
      this.blockSerializedCache.delete(signedBlockRootHex, block, "rejected");
    }
    if (this.validatorMonitor && seenTimestampSec !== undefined) {
      const {slot, proposerIndex} = block.message;
      const blockRoot = blockRootHex;
      const registerBlock = (): void => {
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
    if (signedBlockRootHex !== undefined && seenTimestampSec !== undefined) {
      this.blockSerializedCache.delete(signedBlockRootHex, block, "rejected");
    }
    return gossipBlockError.call(this, error, signedBlockRootHex, blockRootForLog);
  } finally {
    // API publication shares this validator but does not initiate gossip equivocation processing.
    if (seenTimestampSec !== undefined) {
      const {slot, proposerIndex} = block.message;
      if (this.seenBlockProposers.isEquivocating(slot, proposerIndex)) {
        this.processProposerEquivocation(slot, proposerIndex);
      }
    }
  }
}

function gossipBlockError(
  this: BeaconEngineCore,
  error: unknown,
  signedBlockRootHex?: SignedBlockRootHex,
  blockRootForLog?: RootHex
): GossipBlockResult {
  if (
    error instanceof LodestarError &&
    (error.type.code === "INVALID_BLOCK_SSZ" || error.type.code === "SIGNED_BLOCK_ROOT_MISMATCH")
  ) {
    return {
      ...reject(error.type.code, signedBlockRootHex === undefined ? undefined : {signedBlockRoot: signedBlockRootHex}),
      shouldProcessRepeatProposalBlock: false,
    };
  }
  // [beacon-engine] deviation: internal failures return a verdict without penalizing the peer.
  this.logger.error("Error validating gossip block", {root: blockRootForLog, code: "UNEXPECTED_ERROR"}, error as Error);
  return {...ignore("UNEXPECTED_ERROR"), shouldProcessRepeatProposalBlock: false};
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blobSidecar.ts#validateGossipBlobSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export async function validateGossipBlobSidecarBytes(
  this: BeaconEngineCore,
  blobBytes: Uint8Array,
  fork: ForkName,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    const blobSidecar = deserializeGossipMessage(ssz.deneb.BlobSidecar, blobBytes);
    return await validateGossipBlobSidecar.call(this, blobSidecar, fork, subnet);
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip blob sidecar", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

export async function validateGossipBlobSidecar(
  this: BeaconEngineCore,
  blobSidecar: deneb.BlobSidecar,
  fork: ForkName,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    return await runGossipValidation(() =>
      blobSidecarValidation.validateGossipBlobSidecar.call(this, fork, blobSidecar, subnet)
    );
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip blob sidecar", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}
