import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  isStateValidatorsNodesPopulated,
  DataAvailableStatus,
} from "@lodestar/state-transition";
import {bellatrix, deneb} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {ProtoBlock, ExecutionStatus, DataAvailabilityStatus} from "@lodestar/fork-choice";
import {ChainForkConfig} from "@lodestar/config";
import {Logger, toRootHex} from "@lodestar/utils";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconChain} from "../chain.js";
import {BlockInput, ImportBlockOpts, BlockInputType} from "./types.js";
import {POS_PANDA_MERGE_TRANSITION_BANNER} from "./utils/pandaMergeTransitionBanner.js";
import {CAPELLA_OWL_BANNER} from "./utils/ownBanner.js";
import {DENEB_BLOWFISH_BANNER} from "./utils/blowfishBanner.js";
import {verifyBlocksStateTransitionOnly} from "./verifyBlocksStateTransitionOnly.js";
import {verifyBlocksSignatures} from "./verifyBlocksSignatures.js";
import {verifyBlocksExecutionPayload, SegmentExecStatus} from "./verifyBlocksExecutionPayloads.js";
import {verifyBlocksDataAvailability} from "./verifyBlocksDataAvailability.js";
import {writeBlockInputToDb} from "./writeBlockInputToDb.js";

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
  blocksInput: BlockInput[],
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{
  postStates: CachedBeaconStateAllForks[];
  proposerBalanceDeltas: number[];
  segmentExecStatus: SegmentExecStatus;
  dataAvailabilityStatuses: DataAvailabilityStatus[];
  availableBlockInputs: BlockInput[];
}> {
  const blocks = blocksInput.map(({block}) => block);
  if (blocks.length === 0) {
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

  // TODO: Skip in process chain segment
  // Retrieve preState from cache (regen)
  const preState0 = await this.regen
    // transfer cache to process faster, postState will be in block state cache
    .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
    .catch((e) => {
      throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
    });

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
    // batch all I/O operations to reduce overhead
    const [
      segmentExecStatus,
      {dataAvailabilityStatuses, availableTime, availableBlockInputs},
      {postStates, proposerBalanceDeltas, verifyStateTime},
      {verifySignaturesTime},
    ] = await Promise.all([
      // Execution payloads
      opts.skipVerifyExecutionPayload !== true
        ? verifyBlocksExecutionPayload(this, parentBlock, blocks, preState0, abortController.signal, opts)
        : Promise.resolve({
            execAborted: null,
            executionStatuses: blocks.map((_blk) => ExecutionStatus.Syncing),
            mergeBlockFound: null,
          } as SegmentExecStatus),

      // data availability for the blobs
      verifyBlocksDataAvailability(this, blocksInput, abortController.signal, opts),

      // Run state transition only
      // TODO: Ensure it yields to allow flushing to workers and engine API
      verifyBlocksStateTransitionOnly(
        preState0,
        blocksInput,
        // hack availability for state transition eval as availability is separately determined
        blocks.map(() => DataAvailableStatus.available),
        this.logger,
        this.metrics,
        abortController.signal,
        opts
      ),

      // All signatures at once
      opts.skipVerifyBlockSignatures !== true
        ? verifyBlocksSignatures(this.bls, this.logger, this.metrics, preState0, blocks, opts)
        : Promise.resolve({verifySignaturesTime: Date.now()}),

      // ideally we want to only persist blocks after verifying them however the reality is there are
      // rarely invalid blocks we'll batch all I/O operation here to reduce the overhead if there's
      // an error, we'll remove blocks not in forkchoice
      opts.verifyOnly !== true && opts.eagerPersistBlock
        ? writeBlockInputToDb.call(this, blocksInput)
        : Promise.resolve(),
    ]);

    if (opts.verifyOnly !== true) {
      if (segmentExecStatus.execAborted === null && segmentExecStatus.mergeBlockFound !== null) {
        // merge block found and is fully valid = state transition + signatures + execution payload.
        // TODO: Will this banner be logged during syncing?
        logOnPowBlock(this.logger, this.config, segmentExecStatus.mergeBlockFound);
      }

      const fromFork = this.config.getForkName(parentBlock.slot);
      const toFork = this.config.getForkName(blocks[blocks.length - 1].message.slot);

      // If transition through toFork, note won't happen if ${toFork}_EPOCH = 0, will log double on re-org
      if (toFork !== fromFork) {
        switch (toFork) {
          case ForkName.capella:
            this.logger.info(CAPELLA_OWL_BANNER);
            this.logger.info("Activating withdrawals", {epoch: this.config.CAPELLA_FORK_EPOCH});
            break;

          case ForkName.deneb:
            this.logger.info(DENEB_BLOWFISH_BANNER);
            this.logger.info("Activating blobs", {epoch: this.config.DENEB_FORK_EPOCH});
            break;

          default:
        }
      }
    }

    if (segmentExecStatus.execAborted === null) {
      const {executionStatuses, executionTime} = segmentExecStatus;
      if (
        blocksInput.length === 1 &&
        // gossip blocks have seenTimestampSec
        opts.seenTimestampSec !== undefined &&
        blocksInput[0].type !== BlockInputType.preData &&
        executionStatuses[0] === ExecutionStatus.Valid
      ) {
        // Find the max time when the block was actually verified
        const fullyVerifiedTime = Math.max(executionTime, verifyStateTime, verifySignaturesTime);
        const recvTofullyVerifedTime = fullyVerifiedTime / 1000 - opts.seenTimestampSec;
        this.metrics?.gossipBlock.receivedToFullyVerifiedTime.observe(recvTofullyVerifedTime);

        const verifiedToBlobsAvailabiltyTime = Math.max(availableTime - fullyVerifiedTime, 0) / 1000;
        const numBlobs = (blocksInput[0].block as deneb.SignedBeaconBlock).message.body.blobKzgCommitments.length;

        this.metrics?.gossipBlock.verifiedToBlobsAvailabiltyTime.observe({numBlobs}, verifiedToBlobsAvailabiltyTime);
        this.logger.verbose("Verified blockInput fully with blobs availability", {
          slot: blocksInput[0].block.message.slot,
          recvTofullyVerifedTime,
          verifiedToBlobsAvailabiltyTime,
          type: blocksInput[0].type,
          numBlobs,
        });
      }
    }

    return {postStates, dataAvailabilityStatuses, proposerBalanceDeltas, segmentExecStatus, availableBlockInputs};
  } finally {
    abortController.abort();
  }
}

function logOnPowBlock(logger: Logger, config: ChainForkConfig, mergeBlock: bellatrix.BeaconBlock): void {
  const mergeBlockHash = toRootHex(config.getForkTypes(mergeBlock.slot).BeaconBlock.hashTreeRoot(mergeBlock));
  const mergeExecutionHash = toRootHex(mergeBlock.body.executionPayload.blockHash);
  const mergePowHash = toRootHex(mergeBlock.body.executionPayload.parentHash);
  logger.info(POS_PANDA_MERGE_TRANSITION_BANNER);
  logger.info("Execution transitioning from PoW to PoS!!!");
  logger.info("Importing block referencing terminal PoW block", {
    blockHash: mergeBlockHash,
    executionHash: mergeExecutionHash,
    powHash: mergePowHash,
  });
}
