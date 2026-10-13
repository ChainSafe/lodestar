import {ForkName, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {Root, SignedBeaconBlock, SubnetID, ssz} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {GossipActionError} from "../../errors/gossipValidation.js";
import {BlockErrorCode} from "../../errors/index.js";
import * as blobSidecarValidation from "../../validation/blobSidecar.js";
import * as blockValidation from "../../validation/block.js";
import {OpSource} from "../../validatorMonitor.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {
  GossipValidationResult,
  GossipValidationStatus,
  fromResult,
  ignore,
  reject,
  runGossipValidation,
} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/block.ts#validateGossipBlock.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#validateBeaconBlock.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#handleValidBeaconBlock.
 * [beacon-engine] deviation: validation/cache updates run in the engine; the facade retains block import.
 */
export async function validateGossipBlock(
  this: BeaconEngine,
  isClosed: () => boolean,
  blockRoot: Root,
  blockBytes: Uint8Array,
  fork: ForkName,
  // API publication also call this with no seenTimestampSec
  seenTimestampSec?: number
): Promise<GossipValidationResult<blockValidation.GossipBlockValidationResult>> {
  if (blockRoot.length !== 32) return reject("BLOCK_ROOT_MISMATCH");
  const blockRootHex = toRootHex(blockRoot);
  const payloadBlockRoot = isForkPostGloas(fork) ? blockRootHex : null;
  let signedBlock: SignedBeaconBlock | undefined;
  try {
    const {block} = this.blockCache.getOrDeserialize(blockRootHex, blockBytes, fork);
    signedBlock = block;
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#validateBeaconBlock.
    // Seed on entry, including blocks whose parent is still unknown.
    if (payloadBlockRoot !== null) {
      this.seenPayloadEnvelopeInputCache.add({
        blockRootHex: payloadBlockRoot,
        block: block as SignedBeaconBlock<ForkPostGloas>,
        forkName: fork,
      });
    }
    const result = await runGossipValidation(() => blockValidation.validateGossipBlock.call(this, block, fork));
    if (
      result.status === GossipValidationStatus.Reject ||
      (result.status === GossipValidationStatus.Ignore &&
        result.code === BlockErrorCode.REPEAT_PROPOSAL &&
        !this.hasObservedBlockRoot(block.message.slot, block.message.proposerIndex, blockRootHex))
    ) {
      this.blockCache.delete(blockRootHex, block, "rejected");
      if (payloadBlockRoot !== null && seenTimestampSec !== undefined) {
        this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
      }
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
      if (result.status === GossipValidationStatus.Accept) {
        callInNextEventLoop(registerBlock);
      } else if (
        result.status === GossipValidationStatus.Ignore &&
        result.code === BlockErrorCode.REPEAT_PROPOSAL &&
        this.hasObservedBlockRoot(slot, proposerIndex, blockRoot)
      ) {
        registerBlock();
      }
    }
    return result;
  } catch (error) {
    if (signedBlock !== undefined) {
      this.blockCache.delete(blockRootHex, signedBlock, "rejected");
      if (payloadBlockRoot !== null && seenTimestampSec !== undefined) {
        this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
      }
    }
    if (
      error instanceof LodestarError &&
      (error.type.code === "INVALID_BLOCK_SSZ" || error.type.code === "BLOCK_ROOT_MISMATCH")
    ) {
      return reject(error.type.code, {blockRoot: blockRootHex});
    }
    // [beacon-engine] deviation: internal failures return a verdict without penalizing the peer.
    this.logger.error("Error validating gossip block", {root: blockRootHex, code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blobSidecar.ts#validateGossipBlobSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export async function validateGossipBlobSidecar(
  this: BeaconEngine,
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
