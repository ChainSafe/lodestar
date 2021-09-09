/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {AbortSignal} from "@chainsafe/abort-controller";
import {allForks, ssz} from "@chainsafe/lodestar-types";

import {IBlockJob, IChainSegmentJob} from "../interface";
import {ChainEvent} from "../emitter";
import {JobItemQueue} from "../../util/queue";
import {BlockError, BlockErrorCode, ChainSegmentError} from "../errors";

import {BlockProcessOpts, processBlock, processChainSegment} from "./process";
import {validateBlock} from "./validate";
import {IBeaconChain} from "../interface";

const BLOCK_PROCESSOR_QUEUE_MAX_LEN = 256;

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<[IChainSegmentJob | IBlockJob], void>;

  constructor(private readonly chain: IBeaconChain, private readonly opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue(
      (job) => {
        if ((job as IBlockJob).signedBlock) {
          return processBlockJob(this.chain, this.opts, job as IBlockJob);
        } else {
          return processChainSegmentJob(this.chain, this.opts, job as IChainSegmentJob);
        }
      },
      {maxLength: BLOCK_PROCESSOR_QUEUE_MAX_LEN, signal},
      chain.metrics ? chain.metrics.blockProcessorQueue : undefined
    );
  }

  async processBlockJob(job: IBlockJob): Promise<void> {
    await this.jobQueue.push(job);
  }

  async processChainSegment(job: IChainSegmentJob): Promise<void> {
    await this.jobQueue.push(job);
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
export async function processBlockJob(chain: IBeaconChain, opts: BlockProcessOpts, job: IBlockJob): Promise<void> {
  try {
    validateBlock(chain, job);
    await processBlock(chain, opts, job);
  } catch (e) {
    // above functions only throw BlockError
    if (e instanceof BlockError) {
      chain.emitter.emit(ChainEvent.errorBlock, e);
    } else {
      // TODO: Hanlde non-BlockError(s)
      chain.emitter.emit(ChainEvent.errorBlock, e as BlockError);
    }
  }
}

/**
 * Similar to processBlockJob but this process a chain segment
 */
export async function processChainSegmentJob(
  chain: IBeaconChain,
  opts: BlockProcessOpts,
  job: IChainSegmentJob
): Promise<void> {
  const config = chain.config;
  const blocks = job.signedBlocks;

  // Validate and filter out irrelevant blocks
  const filteredChainSegment: allForks.SignedBeaconBlock[] = [];
  for (const [i, block] of blocks.entries()) {
    const child = blocks[i + 1];
    if (child) {
      // If this block has a child in this chain segment, ensure that its parent root matches
      // the root of this block.
      //
      // Without this check it would be possible to have a block verified using the
      // incorrect shuffling. That would be bad, mmkay.
      if (
        !ssz.Root.equals(
          config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
          child.message.parentRoot
        )
      ) {
        throw new ChainSegmentError({
          code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS,
          job,
          importedBlocks: 0,
        });
      }
      // Ensure that the slots are strictly increasing throughout the chain segment.
      if (child.message.slot <= block.message.slot) {
        throw new ChainSegmentError({
          code: BlockErrorCode.NON_LINEAR_SLOTS,
          job,
          importedBlocks: 0,
        });
      }
    }

    try {
      validateBlock(chain, {...job, signedBlock: block});
      // If the block is relevant, add it to the filtered chain segment.
      filteredChainSegment.push(block);
    } catch (e) {
      switch ((e as BlockError).type.code) {
        // If the block is already known, simply ignore this block.
        case BlockErrorCode.BLOCK_IS_ALREADY_KNOWN:
          continue;
        // If the block is the genesis block, simply ignore this block.
        case BlockErrorCode.GENESIS_BLOCK:
          continue;
        // If the block is is for a finalized slot, simply ignore this block.
        //
        // The block is either:
        //
        // 1. In the canonical finalized chain.
        // 2. In some non-canonical chain at a slot that has been finalized already.
        //
        // In the case of (1), there's no need to re-import and later blocks in this
        // segement might be useful.
        //
        // In the case of (2), skipping the block is valid since we should never import it.
        // However, we will potentially get a `ParentUnknown` on a later block. The sync
        // protocol will need to ensure this is handled gracefully.
        case BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT:
          continue;
        // Any other error whilst determining if the block was invalid, return that
        // error.
        default:
          throw new ChainSegmentError({
            // TODO: Stop using jobs in errors
            job: (e as ChainSegmentError).job,
            ...(e as BlockError).type,
            importedBlocks: 0,
          });
      }
    }
  }

  await processChainSegment(chain, opts, {...job, signedBlocks: filteredChainSegment});
}
