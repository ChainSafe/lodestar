import {SignedBeaconBlock, Slot} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {BlockError, BlockErrorCode, isBlockErrorAborted} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {IBlockInput} from "./blockInput/types.js";
import {importBlock} from "./importBlock.js";
import {importExecutionPayload} from "./importExecutionPayload.js";
import {PayloadEnvelopeInput} from "./payloadEnvelopeInput/payloadEnvelopeInput.js";
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
  readonly jobQueue: JobItemQueue<[IBlockInput[], Map<Slot, PayloadEnvelopeInput> | null, ImportBlockOpts], void>;

  constructor(chain: BeaconChain, metrics: Metrics | null, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[IBlockInput[], Map<Slot, PayloadEnvelopeInput> | null, ImportBlockOpts], void>(
      (job, payloadEnvelopes, importOpts) => {
        return processBlocks.call(chain, job, payloadEnvelopes, {...opts, ...importOpts});
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.blockProcessorQueue ?? undefined
    );
  }

  async processBlocksJob(
    job: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
    opts: ImportBlockOpts = {}
  ): Promise<void> {
    await this.jobQueue.push(job, payloadEnvelopes, opts);
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
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<void> {
  if (blocks.length === 0) {
    return; // TODO: or throw?
  }

  try {
    const {relevantBlocks, parentSlots, parentBlock} = verifyBlocksSanityChecks(this, blocks, payloadEnvelopes, opts);

    // No relevant blocks, skip verifyBlocksInEpoch()
    if (relevantBlocks.length === 0 || parentBlock === null) {
      // parentBlock can only be null if relevantBlocks are empty
      return;
    }

    const {warnings: orphanedPayloads} = assertLinearChainSegment(
      this.config,
      relevantBlocks,
      payloadEnvelopes,
      parentBlock
    );
    if (orphanedPayloads != null) {
      for (const orphaned of orphanedPayloads) {
        this.logger.debug("Orphaned payload envelope in chain segment", {
          slot: orphaned.slot,
          blockRoot: orphaned.payloadEnvelopeInput.blockRootHex,
        });
      }
    }

    // Fully verify a block to be imported immediately after. Does not produce any side-effects besides adding intermediate
    // states in the state cache through regen.
    const {
      postStates,
      blockDAStatuses,
      payloadDAStatuses,
      proposerBalanceDeltas,
      segmentExecStatus,
      indexedAttestationsByBlock,
    } = await verifyBlocksInEpoch.call(this, parentBlock, relevantBlocks, payloadEnvelopes, opts);

    // If segmentExecStatus has lvhForkchoice then, the entire segment should be invalid
    // and we need to further propagate
    if (segmentExecStatus.execAborted !== null) {
      if (segmentExecStatus.invalidSegmentLVH !== undefined) {
        this.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLVH);
      }
      throw segmentExecStatus.execAborted.execError;
    }

    const {executionStatuses} = segmentExecStatus;
    const verifiedBlocksBySlot = new Map<Slot, FullyVerifiedBlock>();
    for (let i = 0; i < relevantBlocks.length; i++) {
      const block = relevantBlocks[i];
      verifiedBlocksBySlot.set(block.getBlock().message.slot, {
        blockInput: block,
        postState: postStates[i],
        parentBlockSlot: parentSlots[i],
        executionStatus: executionStatuses[i],
        // start supporting optimistic syncing/processing
        dataAvailabilityStatus: blockDAStatuses[i],
        proposerBalanceDelta: proposerBalanceDeltas[i],
        indexedAttestations: indexedAttestationsByBlock[i],
        // TODO: Make this param mandatory and capture in gossip
        seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
      });
    }

    // Iterate slots from the original `blocks` input (which spans the entire batch including
    // slots filtered out of `relevantBlocks`). The first batch of a checkpoint sync may contain
    // a payload at the anchor slot whose block is already in fork-choice (added by
    // initializeForkChoice as PENDING+EMPTY) and therefore not in verifiedBlocksBySlot — the
    // payload still needs to be imported here to populate the anchor's FULL variant so
    // subsequent slots can find their parent payload.
    const slots = blocks.map((b) => b.getBlock().message.slot);
    for (const slot of slots) {
      const fullyVerifiedBlock = verifiedBlocksBySlot.get(slot);
      if (fullyVerifiedBlock !== undefined) {
        // TODO: Consider batching importBlock too if it takes significant time
        await importBlock.call(this, fullyVerifiedBlock, opts);
      }

      const payloadInput = payloadEnvelopes?.get(slot);
      if (payloadInput?.hasPayloadEnvelope()) {
        if (!payloadInput.isComplete()) {
          // we validated DA before reaching this
          throw new Error(`Payload envelope for slot ${slot} not complete after DA verification`);
        }
        // we already awaited DA in verifyBlocksInEpoch for this segment
        const payloadDA = payloadDAStatuses.get(slot);
        if (payloadDA === undefined) {
          throw new Error(`Missing payload DA status for slot ${slot}`);
        }
        await importExecutionPayload.call(this, payloadInput, payloadDA, {validSignature: false});
      }

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
