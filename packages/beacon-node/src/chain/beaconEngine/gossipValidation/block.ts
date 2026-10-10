import {ForkName, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {SignedBeaconBlock, SubnetID, deneb} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {BlockErrorCode} from "../../errors/index.js";
import * as blobSidecarValidation from "../../validation/blobSidecar.js";
import * as blockValidation from "../../validation/block.js";
import {OpSource} from "../../validatorMonitor.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, GossipValidationStatus, runGossipValidation} from "../gossipValidationResult.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/block.ts#validateGossipBlock.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#validateBeaconBlock.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#handleValidBeaconBlock.
 * [beacon-engine] deviation: validation/cache updates run in the engine; the facade retains block import.
 */
export async function validateGossipBlock(
  this: BeaconEngine,
  isClosed: () => boolean,
  _blockBytes: Uint8Array,
  signedBlock: SignedBeaconBlock,
  fork: ForkName,
  // API publication also call this with no seenTimestampSec
  seenTimestampSec?: number
): Promise<GossipValidationResult<blockValidation.GossipBlockValidationResult>> {
  const payloadBlockRoot = isForkPostGloas(fork)
    ? toRootHex(this.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message))
    : null;
  // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#validateBeaconBlock.
  // Seed on entry, including blocks whose parent is still unknown.
  if (payloadBlockRoot !== null) {
    this.seenPayloadEnvelopeInputCache.add({
      blockRootHex: payloadBlockRoot,
      block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
      forkName: fork,
    });
  }
  let result: GossipValidationResult<blockValidation.GossipBlockValidationResult>;
  try {
    result = await runGossipValidation(() => blockValidation.validateGossipBlock.call(this, signedBlock, fork));
  } catch (error) {
    if (payloadBlockRoot !== null && seenTimestampSec !== undefined) {
      this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
    }
    throw error;
  }
  if (
    payloadBlockRoot !== null &&
    seenTimestampSec !== undefined &&
    (result.status === GossipValidationStatus.Reject ||
      (result.status === GossipValidationStatus.Ignore &&
        result.code === BlockErrorCode.REPEAT_PROPOSAL &&
        !this.hasObservedBlockRoot(signedBlock.message.slot, signedBlock.message.proposerIndex, payloadBlockRoot)))
  ) {
    this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
  }
  if (this.validatorMonitor && seenTimestampSec !== undefined) {
    const {slot, proposerIndex} = signedBlock.message;
    const blockRoot =
      payloadBlockRoot ?? toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
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
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blobSidecar.ts#validateGossipBlobSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export function validateGossipBlobSidecar(
  this: BeaconEngine,
  _blobBytes: Uint8Array,
  fork: ForkName,
  blobSidecar: deneb.BlobSidecar,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(() =>
    blobSidecarValidation.validateGossipBlobSidecar.call(this, fork, blobSidecar, subnet)
  );
}
