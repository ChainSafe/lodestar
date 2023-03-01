import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  isStateValidatorsNodesPopulated,
} from "@lodestar/state-transition";
import {bellatrix} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconChain} from "../chain.js";
import {BlockInput, ImportBlockOpts} from "./types.js";
import {POS_PANDA_MERGE_TRANSITION_BANNER} from "./utils/pandaMergeTransitionBanner.js";
import {CAPELLA_OWL_BANNER} from "./utils/ownBanner.js";
import {verifyBlocksStateTransitionOnly} from "./verifyBlocksStateTransitionOnly.js";
import {verifyBlocksSignatures} from "./verifyBlocksSignatures.js";
import {verifyBlocksExecutionPayload, SegmentExecStatus} from "./verifyBlocksExecutionPayloads.js";

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
    .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
    .catch((e) => {
      throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
    });

  if (!isStateValidatorsNodesPopulated(preState0)) {
    this.logger.verbose("verifyBlocksInEpoch preState0 SSZ cache stats", {
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
    const [segmentExecStatus, {postStates, proposerBalanceDeltas}] = await Promise.all([
      // Execution payloads
      verifyBlocksExecutionPayload(this, parentBlock, blocks, preState0, abortController.signal, opts),
      // Run state transition only
      // TODO: Ensure it yields to allow flushing to workers and engine API
      verifyBlocksStateTransitionOnly(preState0, blocksInput, this.logger, this.metrics, abortController.signal, opts),

      // All signatures at once
      verifyBlocksSignatures(this.bls, this.logger, this.metrics, preState0, blocks, opts),
    ]);

    if (segmentExecStatus.execAborted === null && segmentExecStatus.mergeBlockFound !== null) {
      // merge block found and is fully valid = state transition + signatures + execution payload.
      // TODO: Will this banner be logged during syncing?
      logOnPowBlock(this.logger, this.config, segmentExecStatus.mergeBlockFound);
    }

    const fromFork = this.config.getForkName(parentBlock.slot);
    const toFork = this.config.getForkName(blocks[blocks.length - 1].message.slot);

    // If transition through capella, note won't happen if CAPELLA_EPOCH = 0, will log double on re-org
    if (fromFork !== ForkName.capella && toFork === ForkName.capella) {
      this.logger.info(CAPELLA_OWL_BANNER);
      this.logger.info("Activating withdrawals", {epoch: this.config.CAPELLA_FORK_EPOCH});
    }

    return {postStates, proposerBalanceDeltas, segmentExecStatus};
  } finally {
    abortController.abort();
  }
}

function logOnPowBlock(logger: Logger, config: ChainForkConfig, mergeBlock: bellatrix.BeaconBlock): void {
  const mergeBlockHash = toHexString(config.getForkTypes(mergeBlock.slot).BeaconBlock.hashTreeRoot(mergeBlock));
  const mergeExecutionHash = toHexString(mergeBlock.body.executionPayload.blockHash);
  const mergePowHash = toHexString(mergeBlock.body.executionPayload.parentHash);
  logger.info(POS_PANDA_MERGE_TRANSITION_BANNER);
  logger.info("Execution transitioning from PoW to PoS!!!");
  logger.info("Importing block referencing terminal PoW block", {
    blockHash: mergeBlockHash,
    executionHash: mergeExecutionHash,
    powHash: mergePowHash,
  });
}
