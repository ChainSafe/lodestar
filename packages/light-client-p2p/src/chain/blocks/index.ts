/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {allForks} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {JobItemQueue} from "../../util/queue/index.js";
import {IMetrics} from "../../metrics/metrics.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import type {BeaconChain} from "../chain.js";
import {verifyBlocksInEpoch} from "./verifyBlock.js";
import {importBlock} from "./importBlock.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {verifyBlocksSanityChecks} from "./verifyBlocksSanityChecks.js";
export {ImportBlockOpts} from "./types.js";

const QUEUE_MAX_LENGHT = 256;

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<[allForks.SignedBeaconBlock[], ImportBlockOpts], void>;

  constructor(chain: BeaconChain, metrics: IMetrics | null, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[allForks.SignedBeaconBlock[], ImportBlockOpts], void>(
      (job, importOpts) => {
        return processBlocks.call(chain, job, {...opts, ...importOpts});
      },
      {maxLength: QUEUE_MAX_LENGHT, signal},
      metrics?.blockProcessorQueue ?? undefined
    );
  }

  async processBlocksJob(job: allForks.SignedBeaconBlock[], opts: ImportBlockOpts = {}): Promise<void> {
    await this.jobQueue.push(job, opts);
  }
}

/**
 * Validate and process a block
 *
 * The only effects of running this are:
 * - forkChoice update, in the case of a valid block
 * - various events emitted: checkpoint, forkChoice:*, head, block, error:block
 * - (state cache update, from state regeneration)
 *
 * All other effects are provided by downstream event handlers
 */
export async function processBlocks(
  this: BeaconChain,
  blocks: allForks.SignedBeaconBlock[],
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<void> {
  if (blocks.length === 0) {
    return; // TODO: or throw?
  } else if (blocks.length > 1) {
    assertLinearChainSegment(this.config, blocks);
  }

  try {
    const {relevantBlocks, parentSlots, parentBlock} = verifyBlocksSanityChecks(this, blocks, opts);

    // No relevant blocks, skip verifyBlocksInEpoch()
    if (relevantBlocks.length === 0 || parentBlock === null) {
      // parentBlock can only be null if relevantBlocks are empty
      return;
    }

    // Fully verify a block to be imported immediately after. Does not produce any side-effects besides adding intermediate
    // states in the state cache through regen.
    const {postStates, proposerBalanceDeltas, segmentExecStatus} = await verifyBlocksInEpoch.call(
      this,
      parentBlock,
      relevantBlocks,
      opts
    );

    // If segmentExecStatus has lvhForkchoice then, the entire segment should be invalid
    // and we need to further propagate
    if (segmentExecStatus.execAborted !== null) {
      if (segmentExecStatus.invalidSegmentLHV !== undefined) {
        this.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLHV);
      }
      throw segmentExecStatus.execAborted.execError;
    }

    const {executionStatuses} = segmentExecStatus;
    const fullyVerifiedBlocks = relevantBlocks.map(
      (block, i): FullyVerifiedBlock => ({
        block,
        postState: postStates[i],
        parentBlockSlot: parentSlots[i],
        executionStatus: executionStatuses[i],
        proposerBalanceDelta: proposerBalanceDeltas[i],
        // TODO: Make this param mandatory and capture in gossip
        seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
      })
    );

    for (const fullyVerifiedBlock of fullyVerifiedBlocks) {
      // No need to sleep(0) here since `importBlock` includes a disk write
      // TODO: Consider batching importBlock too if it takes significant time
      await importBlock.call(this, fullyVerifiedBlock, opts);
    }
  } catch (e) {
    // above functions should only throw BlockError
    const err = getBlockError(e, blocks[0]);

    // TODO: De-duplicate with logic above
    // ChainEvent.errorBlock
    if (!(err instanceof BlockError)) {
      this.logger.error("Non BlockError received", {}, err);
    } else if (!opts.disableOnBlockError) {
      this.logger.error("Block error", {slot: err.signedBlock.message.slot}, err);

      if (err.type.code === BlockErrorCode.INVALID_SIGNATURE) {
        const {signedBlock} = err;
        const blockSlot = signedBlock.message.slot;
        const {state} = err.type;
        const forkTypes = this.config.getForkTypes(blockSlot);
        this.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `${blockSlot}_invalid_signature`);
        this.persistInvalidSszView(state, `${state.slot}_invalid_signature`);
      } else if (err.type.code === BlockErrorCode.INVALID_STATE_ROOT) {
        const {signedBlock} = err;
        const blockSlot = signedBlock.message.slot;
        const {preState, postState} = err.type;
        const forkTypes = this.config.getForkTypes(blockSlot);
        const invalidRoot = toHex(postState.hashTreeRoot());

        const suffix = `slot_${blockSlot}_invalid_state_root_${invalidRoot}`;
        this.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, suffix);
        this.persistInvalidSszView(preState, `${suffix}_preState`);
        this.persistInvalidSszView(postState, `${suffix}_postState`);
      }
    }

    throw err;
  }
}

function getBlockError(e: unknown, block: allForks.SignedBeaconBlock): BlockError {
  if (e instanceof BlockError) {
    return e;
  } else if (e instanceof Error) {
    const blockError = new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
    blockError.stack = e.stack;
    return blockError;
  } else {
    return new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
  }
}
