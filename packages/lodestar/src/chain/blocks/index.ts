/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {AbortSignal} from "@chainsafe/abort-controller";
import {allForks} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainEvent} from "../emitter";
import {JobItemQueue} from "../../util/queue";
import {BlockError, BlockErrorCode, ChainSegmentError} from "../errors";
import {verifyBlock, VerifyBlockModules} from "./verifyBlock";
import {importBlock, ImportBlockModules} from "./importBlock";
import {assertLinearChainSegment} from "./utils/chainSegment";
import {BlockProcessOpts} from "../options";
import {PartiallyVerifiedBlock} from "./types";
export {PartiallyVerifiedBlockFlags} from "./types";

const QUEUE_MAX_LENGHT = 256;

export type ProcessBlockModules = VerifyBlockModules & ImportBlockModules;

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<[PartiallyVerifiedBlock[] | PartiallyVerifiedBlock], void>;

  constructor(modules: ProcessBlockModules, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue(
      (job) => {
        if (!Array.isArray(job)) {
          return processBlock(modules, job, opts);
        } else {
          return processChainSegment(modules, job, opts);
        }
      },
      {maxLength: QUEUE_MAX_LENGHT, signal},
      modules.metrics ? modules.metrics.blockProcessorQueue : undefined
    );
  }

  async processBlockJob(job: PartiallyVerifiedBlock): Promise<void> {
    await this.jobQueue.push(job);
  }

  async processChainSegment(job: PartiallyVerifiedBlock[]): Promise<void> {
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
export async function processBlock(
  modules: ProcessBlockModules,
  partiallyVerifiedBlock: PartiallyVerifiedBlock,
  opts: BlockProcessOpts
): Promise<void> {
  try {
    const fullyVerifiedBlock = await verifyBlock(modules, partiallyVerifiedBlock, opts);
    await importBlock(modules, fullyVerifiedBlock);
  } catch (e) {
    // above functions should only throw BlockError
    const err = getBlockError(e, partiallyVerifiedBlock.block);
    modules.emitter.emit(ChainEvent.errorBlock, err);

    throw err;
  }
}

/**
 * Similar to processBlockJob but this process a chain segment
 */
export async function processChainSegment(
  modules: ProcessBlockModules,
  partiallyVerifiedBlocks: PartiallyVerifiedBlock[],
  opts: BlockProcessOpts
): Promise<void> {
  const blocks = partiallyVerifiedBlocks.map((b) => b.block);
  assertLinearChainSegment(modules.config, blocks);

  let importedBlocks = 0;

  for (const partiallyVerifiedBlock of partiallyVerifiedBlocks) {
    try {
      // TODO: Re-use preState
      const fullyVerifiedBlock = await verifyBlock(modules, partiallyVerifiedBlock, opts);
      await importBlock(modules, fullyVerifiedBlock);
      importedBlocks++;

      // this avoids keeping our node busy processing blocks
      await sleep(0);
    } catch (e) {
      if (
        e instanceof BlockError &&
        // If the block is already known, simply ignore this block.
        (e.type.code === BlockErrorCode.ALREADY_KNOWN ||
          // If the block is the genesis block, simply ignore this block.
          e.type.code === BlockErrorCode.GENESIS_BLOCK ||
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
          e.type.code === BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT)
      ) {
        continue;
      }

      const err = getBlockError(e, partiallyVerifiedBlock.block);
      modules.emitter.emit(ChainEvent.errorBlock, err);

      // Convert to ChainSegmentError to append `importedBlocks` data
      const chainSegmentError = new ChainSegmentError(partiallyVerifiedBlock.block, err.type, importedBlocks);
      chainSegmentError.stack = err.stack;
      throw chainSegmentError;
    }
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
