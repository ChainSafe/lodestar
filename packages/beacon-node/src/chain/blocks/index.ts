import {ExecutionStatus} from "@lodestar/fork-choice";
import {SignedBeaconBlock, Slot, gloas} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {BlockError, BlockErrorCode, isBlockErrorAborted} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {IBlockInput} from "./blockInput/types.js";
import {importBlock} from "./importBlock.js";
import {FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {verifyBlocksInEpoch} from "./verifyBlock.js";
import {verifyBlocksSanityChecks} from "./verifyBlocksSanityChecks.js";

export {AttestationImportOpt, type ImportBlockOpts} from "./types.js";

const QUEUE_MAX_LENGTH = 256;

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<
    [IBlockInput[], Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null, ImportBlockOpts],
    void
  >;

  constructor(chain: BeaconChain, metrics: Metrics | null, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<
      [IBlockInput[], Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null, ImportBlockOpts],
      void
    >(
      (job, envelopes, importOpts) => {
        return processBlocks.call(chain, job, envelopes, {...opts, ...importOpts});
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.blockProcessorQueue ?? undefined
    );
  }

  async processBlocksJob(
    job: IBlockInput[],
    envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
    opts: ImportBlockOpts = {}
  ): Promise<void> {
    await this.jobQueue.push(job, envelopes, opts);
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
  blocks: IBlockInput[],
  envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<void> {
  if (blocks.length === 0) {
    return; // TODO: or throw?
  }

  try {
    const {relevantBlocks, parentSlots, parentBlock} = verifyBlocksSanityChecks(this, blocks, opts);

    // No relevant blocks, skip verifyBlocksInEpoch()
    if (relevantBlocks.length === 0 || parentBlock === null) {
      // parentBlock can only be null if relevantBlocks are empty
      return;
    }

    assertLinearChainSegment(this.config, relevantBlocks, envelopes, parentBlock);

    // Fully verify a block to be imported immediately after. Does not produce any side-effects besides adding intermediate
    // states in the state cache through regen.
    const {
      postBlockStates,
      dataAvailabilityStatuses,
      proposerBalanceDeltas,
      segmentExecStatus,
      indexedAttestationsByBlock,
      postEnvelopeStates,
    } = await verifyBlocksInEpoch.call(this, parentBlock, relevantBlocks, envelopes, opts);

    // If segmentExecStatus has lvhForkchoice then, the entire segment should be invalid
    // and we need to further propagate
    if (segmentExecStatus.execAborted !== null) {
      if (segmentExecStatus.invalidSegmentLVH !== undefined) {
        this.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLVH);
      }
      throw segmentExecStatus.execAborted.execError;
    }

    const {executionStatuses} = segmentExecStatus;
    const fullyVerifiedBlocks = relevantBlocks.map((block, i): FullyVerifiedBlock => {
      const postEnvelopeState = postEnvelopeStates.get(block.getBlock().message.slot) ?? null;
      const executionStatus = executionStatuses[i];
      const baseFields = {
        blockInput: block,
        postBlockState: postBlockStates[i],
        parentBlockSlot: parentSlots[i],
        // start supporting optimistic syncing/processing
        dataAvailabilityStatus: dataAvailabilityStatuses[i],
        proposerBalanceDelta: proposerBalanceDeltas[i],
        indexedAttestations: indexedAttestationsByBlock[i],
        // TODO: Make this param mandatory and capture in gossip
        seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
      };

      if (postEnvelopeState !== null) {
        if (executionStatus !== ExecutionStatus.Valid && executionStatus !== ExecutionStatus.Syncing) {
          throw new Error(
            `postEnvelopeState is set but executionStatus is ${executionStatus}, expected Valid or Syncing. slot=${block.getBlock().message.slot} blockIndex=${i}`
          );
        }
        return {...baseFields, postEnvelopeState, executionStatus};
      }

      return {...baseFields, postEnvelopeState: null, executionStatus};
    });

    for (const fullyVerifiedBlock of fullyVerifiedBlocks) {
      // TODO: Consider batching importBlock too if it takes significant time
      await importBlock.call(this, fullyVerifiedBlock, opts);
      await nextEventLoop();
    }
  } catch (e) {
    if (isErrorAborted(e) || isQueueErrorAborted(e) || isBlockErrorAborted(e)) {
      return; // Ignore
    }

    // above functions should only throw BlockError
    const err = getBlockError(e, blocks[0].getBlock());

    // TODO: De-duplicate with logic above
    // ChainEvent.errorBlock
    if (!(err instanceof BlockError)) {
      this.logger.debug("Non BlockError received", {}, err);
    } else if (!opts.disableOnBlockError) {
      this.logger.debug("Block error", {slot: err.signedBlock.message.slot}, err);

      if (err.type.code === BlockErrorCode.INVALID_SIGNATURE) {
        const {signedBlock} = err;
        const blockSlot = signedBlock.message.slot;
        const {state} = err.type;
        const forkTypes = this.config.getForkTypes(blockSlot);
        this.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `${blockSlot}_invalid_signature`);
        this.persistInvalidSszBytes("BeaconState", state.serialize(), `${state.slot}_invalid_signature`);
      } else if (err.type.code === BlockErrorCode.INVALID_STATE_ROOT) {
        const {signedBlock} = err;
        const blockSlot = signedBlock.message.slot;
        const {preState, postState} = err.type;
        const preRoot = preState.hashTreeRoot();
        const postRoot = postState.hashTreeRoot();
        this.persistInvalidStateRoot(preState, postState, signedBlock).catch((e) => {
          this.logger.error(
            "Error persisting invalid state root objects",
            {slot: blockSlot, preStateRoot: toRootHex(preRoot), postStateRoot: toRootHex(postRoot)},
            e
          );
        });
      }
    }

    throw err;
  }
}

function getBlockError(e: unknown, block: SignedBeaconBlock): BlockError {
  if (e instanceof BlockError) {
    return e;
  }

  if (e instanceof Error) {
    const blockError = new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e});
    blockError.stack = e.stack;
    return blockError;
  }

  return new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
}
