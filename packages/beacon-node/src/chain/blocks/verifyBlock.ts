import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ForkSeq, isForkPostFulu} from "@lodestar/params";
import {DataAvailabilityStatus, computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot, deneb, sszTypesFor} from "@lodestar/types";
import {getBlobKzgCommitments} from "../../util/dataColumns.js";
import type {BeaconChain} from "../chain.js";
import {BlockProcessOpts} from "../options.js";
import {DAType, IBlockInput} from "./blockInput/index.js";
import {PayloadEnvelopeInput} from "./payloadEnvelopeInput/payloadEnvelopeInput.js";
import {ImportBlockOpts} from "./types.js";
import {DENEB_BLOWFISH_BANNER} from "./utils/blowfishBanner.js";
import {ELECTRA_GIRAFFE_BANNER} from "./utils/giraffeBanner.js";
import {CAPELLA_OWL_BANNER} from "./utils/ownBanner.js";
import {FULU_ZEBRA_BANNER} from "./utils/zebraBanner.js";
import {verifyBlocksDataAvailability} from "./verifyBlocksDataAvailability.js";
import {SegmentExecStatus, verifyBlocksExecutionPayload} from "./verifyBlocksExecutionPayloads.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

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
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{
  segmentExecStatus: SegmentExecStatus;
  blockDAStatuses: DataAvailabilityStatus[];
  payloadDAStatuses: Map<Slot, DataAvailabilityStatus>;
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

  // Per-block SSZ bytes for the engine's bytes-first contract (unused by the JS engine). Gossip + sync
  // populate serializedCache; fall back to serializing on a cache miss so all call sites pass real bytes.
  const blockBytes = blockInputs.map((blockInput) => {
    const block = blockInput.getBlock();
    return this.serializedCache.get(block) ?? sszTypesFor(blockInput.forkName).SignedBeaconBlock.serialize(block);
  });

  const abortController = new AbortController();

  try {
    // Start execution payload verification first (async request to execution client)
    const verifyExecutionPayloadsPromise =
      opts.skipVerifyExecutionPayload !== true
        ? verifyBlocksExecutionPayload(this, parentBlock, blockInputs, abortController.signal, opts)
        : Promise.resolve({
            execAborted: null,
            executionStatuses: blocks.map((_blk) => ExecutionStatus.Syncing),
          } as SegmentExecStatus);

    // Pick the data-availability source by fork:
    // - Pre-Gloas: blob/Fulu-column data lives in IBlockInput → verifyBlocksDataAvailability.
    // - Post-Gloas: verifyPayloadsDataAvailability (payload-level DA, keyed by slot).
    const daAvailabilityPromise: Promise<{
      blockDAStatuses: DataAvailabilityStatus[];
      payloadDAStatuses: Map<Slot, DataAvailabilityStatus>;
      availableTime: number;
    }> =
      fork >= ForkSeq.gloas
        ? (async () => {
            // Validate DA for ALL payloads in the Map, not just those paired with blockInputs.
            // A checkpoint-sync batch may include a payload for a slot whose block was filtered
            // out of relevantBlocks (e.g., the anchor at the finalized slot); that payload still
            // needs DA validation so it can be imported in processBlocks.
            const payloadInputsForDa: PayloadEnvelopeInput[] =
              payloadEnvelopes !== null ? Array.from(payloadEnvelopes.values()) : [];
            const {dataAvailabilityStatuses, availableTime} = await verifyPayloadsDataAvailability(
              payloadInputsForDa,
              abortController.signal
            );

            const payloadDAStatuses = new Map<Slot, DataAvailabilityStatus>();
            for (let i = 0; i < payloadInputsForDa.length; i++) {
              payloadDAStatuses.set(payloadInputsForDa[i].slot, dataAvailabilityStatuses[i]);
            }
            return {
              // post-gloas, DataAvailabilityStatus is NotRequired for forkChoice.onBlock() ProtoBlock
              blockDAStatuses: blockInputs.map(() => DataAvailabilityStatus.NotRequired),
              payloadDAStatuses,
              availableTime,
            };
          })()
        : (async () => {
            const {dataAvailabilityStatuses, availableTime} = await verifyBlocksDataAvailability(
              blockInputs,
              abortController.signal
            );
            return {
              blockDAStatuses: dataAvailabilityStatuses,
              payloadDAStatuses: new Map<Slot, DataAvailabilityStatus>(),
              availableTime,
            };
          })();

    // batch all I/O operations to reduce overhead
    const [
      segmentExecStatus,
      {blockDAStatuses, payloadDAStatuses, availableTime},
      {verifyStateTime, verifySignaturesTime},
    ] = await Promise.all([
      verifyExecutionPayloadsPromise,

      // data availability (fork-specific; see daAvailabilityPromise above)
      daAvailabilityPromise,

      this.beaconEngine.verifyBlocks(blockBytes, parentBlock, blockInputs, opts, abortController.signal),
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
        // PreData (pre-deneb) and NoData (gloas) carry no blob data on the block — skip metric
        blockInputs[0].type !== DAType.PreData &&
        blockInputs[0].type !== DAType.NoData &&
        executionStatuses[0] === ExecutionStatus.Valid
      ) {
        // Find the max time when the block was actually verified
        const fullyVerifiedTime = Math.max(executionTime, verifyStateTime, verifySignaturesTime);
        const recvTofullyVerifedTime = fullyVerifiedTime / 1000 - opts.seenTimestampSec;
        this.metrics?.gossipBlock.receivedToFullyVerifiedTime.observe(recvTofullyVerifedTime);

        const verifiedToBlobsAvailabiltyTime = Math.max(availableTime - fullyVerifiedTime, 0) / 1000;
        const block = blockInputs[0].getBlock();
        const numBlobs = getBlobKzgCommitments(blockInputs[0].forkName, block as deneb.SignedBeaconBlock).length;

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

    return {segmentExecStatus, blockDAStatuses, payloadDAStatuses};
  } finally {
    abortController.abort();
  }
}
