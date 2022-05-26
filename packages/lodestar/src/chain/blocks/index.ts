/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {allForks} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainEvent} from "../emitter.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {BlockError, BlockErrorCode, ChainSegmentError} from "../errors/index.js";
import {verifyBlock, VerifyBlockModules} from "./verifyBlock.js";
import {importBlock, ImportBlockModules} from "./importBlock.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {BlockProcessOpts} from "../options.js";
import {PartiallyVerifiedBlock} from "./types.js";
export {PartiallyVerifiedBlockFlags} from "./types.js";

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

    if (
      partiallyVerifiedBlock.ignoreIfKnown &&
      (err.type.code === BlockErrorCode.ALREADY_KNOWN || err.type.code === BlockErrorCode.GENESIS_BLOCK)
    ) {
      // Flag ignoreIfKnown causes BlockErrorCodes ALREADY_KNOWN, GENESIS_BLOCK to resolve.
      // Return before emitting to not cause loud logging.
      return;
    }

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
      // above functions should only throw BlockError
      const err = getBlockError(e, partiallyVerifiedBlock.block);

      if (
        partiallyVerifiedBlock.ignoreIfKnown &&
        (err.type.code === BlockErrorCode.ALREADY_KNOWN || err.type.code === BlockErrorCode.GENESIS_BLOCK)
      ) {
        continue;
      }
      if (partiallyVerifiedBlock.ignoreIfFinalized && err.type.code == BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT) {
        continue;
      }

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
