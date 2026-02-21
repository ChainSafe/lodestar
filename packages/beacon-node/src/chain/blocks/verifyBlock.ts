import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, isForkPostFulu} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  computeEpochAtSlot,
  isStateValidatorsNodesPopulated,
} from "@lodestar/state-transition";
import {IndexedAttestation, deneb} from "@lodestar/types";
import {sleep, toRootHex} from "@lodestar/utils";
import type {BeaconChain} from "../chain.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {RegenCaller} from "../regen/index.js";
import {DAType, IBlockInput} from "./blockInput/index.js";
import {ImportBlockOpts} from "./types.js";
import {DENEB_BLOWFISH_BANNER} from "./utils/blowfishBanner.js";
import {ELECTRA_GIRAFFE_BANNER} from "./utils/giraffeBanner.js";
import {CAPELLA_OWL_BANNER} from "./utils/ownBanner.js";
import {FULU_ZEBRA_BANNER} from "./utils/zebraBanner.js";
import {verifyBlocksDataAvailability} from "./verifyBlocksDataAvailability.js";
import {SegmentExecStatus, verifyBlocksExecutionPayload} from "./verifyBlocksExecutionPayloads.js";
import {verifyBlocksSignatures} from "./verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "./verifyBlocksStateTransitionOnly.js";

/**
 * Verifies 1 or more blocks are fully valid; from a linear sequence of blocks.
 *
 * To relieve the main thread signatures are verified separately in workers with chain.bls worker pool.
 * In parallel it:
 * - Run full state transition in sequence
 * - Verify all block's signatures in parallel
 * - Submit execution payloads to EL in sequence
 *
 * If there's an error during one of the steps, the rest are aborted with an AbortController.
 */
export async function verifyBlocksInEpoch(
  this: BeaconChain,
  parentBlock: ProtoBlock,
  blockInputs: IBlockInput[],
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{
  postStates: CachedBeaconStateAllForks[];
  proposerBalanceDeltas: number[];
  segmentExecStatus: SegmentExecStatus;
  dataAvailabilityStatuses: DataAvailabilityStatus[];
  indexedAttestationsByBlock: IndexedAttestation[][];
}> {
  const blocks = blockInputs.map((blockInput) => blockInput.getBlock());
  const lastBlock = blocks.at(-1);
  if (!lastBlock) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  const block0 = blocks[0];
  const block0Epoch = computeEpochAtSlot(block0.message.slot);

  // Ensure all blocks are in the same epoch
  for (let i = 1; i < blocks.length; i++) {
    const blockSlot = blocks[i].message.slot;
    if (block0Epoch !== computeEpochAtSlot(blockSlot)) {
      throw Error(`Block ${i} slot ${blockSlot} not in same epoch ${block0Epoch}`);
    }
  }

  // All blocks are in the same epoch
  const fork = this.config.getForkSeq(block0.message.slot);

  // For Gloas blocks: if the parent's envelope hasn't been imported yet (EMPTY/PENDING status),
  // check chain.pendingEnvelopes for a cached envelope and import it first.
  // If not immediately available, wait briefly for the envelope to arrive via gossip.
  // This ensures getPreState returns the post-envelope (FULL) state.
  if (parentBlock.parentBlockHash !== null && parentBlock.payloadStatus !== PayloadStatus.FULL) {
    const parentRootHex = toRootHex(block0.message.parentRoot);

    // Try up to 15 times with 300ms delay (total max wait: ~4.5s)
    // Needs to be long enough for envelopes to arrive via gossip, especially during
    // UnknownBlockSync catch-up where multiple blocks are processed in sequence.
    for (let attempt = 0; attempt < 15; attempt++) {
      // Re-check fork-choice — envelope may have been imported by another path (gossip handler)
      const updatedParent = this.forkChoice.getBlockHex(parentRootHex, PayloadStatus.FULL);
      if (updatedParent) break;

      const pendingEnvelope = this.pendingEnvelopes.get(parentRootHex);
      if (pendingEnvelope) {
        try {
          await this.importExecutionPayloadEnvelope(pendingEnvelope);
          this.pendingEnvelopes.delete(parentRootHex);
          this.logger.info("Imported pending parent envelope before block import", {
            parentRoot: parentRootHex,
            parentSlot: parentBlock.slot,
            childSlot: block0.message.slot,
            attempt,
          });
          break;
        } catch (e) {
          this.logger.debug("Failed importing pending parent envelope", {parentRoot: parentRootHex}, e as Error);
          // Don't break — envelope stays in cache, retry on next iteration
          // Import may succeed after EL catches up or state becomes available
        }
      }

      // Envelope not available yet — yield to event loop so gossip can deliver it
      if (attempt < 14) {
        await sleep(300);
      }
    }
  }

  // TODO: Skip in process chain segment
  // Retrieve preState from cache (regen)
  const preState0 = await this.regen
    // transfer cache to process faster, postState will be in block state cache
    .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
    .catch((e) => {
      throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
    });

  // in forky condition, make sure to populate ShufflingCache with regened state
  // otherwise it may fail to get indexed attestations from shuffling cache later
  this.shufflingCache.processState(preState0);

  if (!isStateValidatorsNodesPopulated(preState0)) {
    this.logger.verbose("verifyBlocksInEpoch preState0 SSZ cache stats", {
      slot: preState0.slot,
      cache: isStateValidatorsNodesPopulated(preState0),
      clonedCount: preState0.clonedCount,
      clonedCountWithTransferCache: preState0.clonedCountWithTransferCache,
      createdWithTransferCache: preState0.createdWithTransferCache,
    });
  }

  // Ensure the state is in the same epoch as block0
  if (block0Epoch !== computeEpochAtSlot(preState0.slot)) {
    throw Error(`preState at slot ${preState0.slot} must be dialed to block epoch ${block0Epoch}`);
  }

  const abortController = new AbortController();

  try {
    // Start execution payload verification first (async request to execution client)
    const verifyExecutionPayloadsPromise =
      opts.skipVerifyExecutionPayload !== true
        ? verifyBlocksExecutionPayload(this, parentBlock, blockInputs, preState0, abortController.signal, opts)
        : Promise.resolve({
            execAborted: null,
            executionStatuses: blocks.map((_blk) => ExecutionStatus.Syncing),
          } as SegmentExecStatus);

    // Store indexed attestations for each block to avoid recomputing them during import
    const indexedAttestationsByBlock: IndexedAttestation[][] = [];
    for (const [i, block] of blocks.entries()) {
      indexedAttestationsByBlock[i] = block.message.body.attestations.map((attestation) => {
        const attEpoch = computeEpochAtSlot(attestation.data.slot);
        const decisionRoot = preState0.epochCtx.getShufflingDecisionRoot(attEpoch);
        return this.shufflingCache.getIndexedAttestation(attEpoch, decisionRoot, fork, attestation);
      });
    }

    // batch all I/O operations to reduce overhead
    const [
      segmentExecStatus,
      {dataAvailabilityStatuses, availableTime},
      {postStates, proposerBalanceDeltas, verifyStateTime},
      {verifySignaturesTime},
    ] = await Promise.all([
      verifyExecutionPayloadsPromise,

      // data availability for the blobs
      verifyBlocksDataAvailability(blockInputs, abortController.signal),

      // Run state transition only
      // TODO: Ensure it yields to allow flushing to workers and engine API
      verifyBlocksStateTransitionOnly(
        preState0,
        blockInputs,
        // hack availability for state transition eval as availability is separately determined
        blocks.map(() => DataAvailabilityStatus.Available),
        this.logger,
        this.metrics,
        this.validatorMonitor,
        abortController.signal,
        opts
      ),

      // All signatures at once
      opts.skipVerifyBlockSignatures !== true
        ? verifyBlocksSignatures(
            this.config,
            this.bls,
            this.logger,
            this.metrics,
            preState0,
            blocks,
            indexedAttestationsByBlock,
            opts
          )
        : Promise.resolve({verifySignaturesTime: Date.now()}),
    ]);

    if (opts.verifyOnly !== true) {
      const fromForkBoundary = this.config.getForkBoundaryAtEpoch(computeEpochAtSlot(parentBlock.slot));
      const toForkBoundary = this.config.getForkBoundaryAtEpoch(computeEpochAtSlot(lastBlock.message.slot));

      // If transition through toFork, note won't happen if ${toFork}_EPOCH = 0, will log double on re-org
      if (toForkBoundary.fork !== fromForkBoundary.fork) {
        switch (toForkBoundary.fork) {
          case ForkName.capella:
            this.logger.info(CAPELLA_OWL_BANNER);
            this.logger.info("Activating withdrawals", {epoch: this.config.CAPELLA_FORK_EPOCH});
            break;

          case ForkName.deneb:
            this.logger.info(DENEB_BLOWFISH_BANNER);
            this.logger.info("Activating blobs", {epoch: this.config.DENEB_FORK_EPOCH});
            break;

          case ForkName.electra:
            this.logger.info(ELECTRA_GIRAFFE_BANNER);
            this.logger.info("Activating maxEB", {epoch: this.config.ELECTRA_FORK_EPOCH});
            break;

          case ForkName.fulu:
            this.logger.info(FULU_ZEBRA_BANNER);
            this.logger.info("Activating peerDAS", {epoch: this.config.FULU_FORK_EPOCH});
            break;

          default:
        }
      }

      if (isForkPostFulu(fromForkBoundary.fork)) {
        const fromBlobParameters = this.config.getBlobParameters(fromForkBoundary.epoch);
        const toBlobParameters = this.config.getBlobParameters(toForkBoundary.epoch);

        if (toBlobParameters.epoch !== fromBlobParameters.epoch) {
          const {epoch, maxBlobsPerBlock} = toBlobParameters;

          this.logger.info("Activating BPO fork", {epoch, maxBlobsPerBlock});
        }
      }
    }

    if (segmentExecStatus.execAborted === null) {
      const {executionStatuses, executionTime} = segmentExecStatus;
      if (
        blockInputs.length === 1 &&
        // gossip blocks have seenTimestampSec
        opts.seenTimestampSec !== undefined &&
        blockInputs[0].type !== DAType.PreData &&
        executionStatuses[0] === ExecutionStatus.Valid
      ) {
        // Find the max time when the block was actually verified
        const fullyVerifiedTime = Math.max(executionTime, verifyStateTime, verifySignaturesTime);
        const recvTofullyVerifedTime = fullyVerifiedTime / 1000 - opts.seenTimestampSec;
        this.metrics?.gossipBlock.receivedToFullyVerifiedTime.observe(recvTofullyVerifedTime);

        const verifiedToBlobsAvailabiltyTime = Math.max(availableTime - fullyVerifiedTime, 0) / 1000;
        const block = blockInputs[0].getBlock() as deneb.SignedBeaconBlock;
        const numBlobs = block.message.body.blobKzgCommitments.length;

        this.metrics?.gossipBlock.verifiedToBlobsAvailabiltyTime.observe({numBlobs}, verifiedToBlobsAvailabiltyTime);
        this.logger.verbose("Verified blockInput fully with blobs availability", {
          slot: block.message.slot,
          recvTofullyVerifedTime,
          verifiedToBlobsAvailabiltyTime,
          type: blockInputs[0].type,
          numBlobs,
        });
      }
    } else {
      this.logger.verbose(
        "Block verification aborted due to execution payload",
        {},
        segmentExecStatus.execAborted.execError
      );
    }

    return {postStates, dataAvailabilityStatuses, proposerBalanceDeltas, segmentExecStatus, indexedAttestationsByBlock};
  } finally {
    abortController.abort();
  }
}
