import {BlockExecutionStatus} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
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
import {ImportBlockOpts} from "./types.js";
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
    const {relevantBlocks, parentBlock} = verifyBlocksSanityChecks(this, blocks, payloadEnvelopes, opts);

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
    const {segmentExecStatus, blockDAStatuses, payloadDAStatuses} = await verifyBlocksInEpoch.call(
      this,
      parentBlock,
      relevantBlocks,
      payloadEnvelopes,
      opts
    );

    // verifyBlocksInEpoch cached the verified consensus bundles in the engine (by root). Ensure they
    // are always evicted — on the execAborted throw below, on a mid-loop import error, and on success
    // (importBlock deletes each as it consumes it, so the sweep is a no-op cleanup of any remainder).
    const verifiedBlockRoots = relevantBlocks.map((b) => b.blockRootHex);
    try {
      // If segmentExecStatus has lvhForkchoice then, the entire segment should be invalid
      // and we need to further propagate
      if (segmentExecStatus.execAborted !== null) {
        if (segmentExecStatus.invalidSegmentLVH !== undefined) {
          this.beaconEngine.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLVH);
        }
        throw segmentExecStatus.execAborted.execError;
      }

      const {executionStatuses} = segmentExecStatus;
      const blockInputsBySlot = new Map<
        Slot,
        {blockInput: IBlockInput; executionStatus: BlockExecutionStatus; blockDAStatus: DataAvailabilityStatus}
      >();
      for (let i = 0; i < relevantBlocks.length; i++) {
        const block = relevantBlocks[i];
        blockInputsBySlot.set(block.getBlock().message.slot, {
          blockInput: block,
          executionStatus: executionStatuses[i],
          blockDAStatus: blockDAStatuses[i],
        });
      }

      const slotSet = new Set<Slot>(blocks.map((b) => b.getBlock().message.slot));
      if (payloadEnvelopes) {
        for (const slot of payloadEnvelopes.keys()) slotSet.add(slot);
      }
      const slots = Array.from(slotSet).sort((a, b) => a - b);
      for (const slot of slots) {
        const entry = blockInputsBySlot.get(slot);
        if (entry !== undefined) {
          await importBlock.call(this, entry.blockInput, entry.executionStatus, entry.blockDAStatus, opts);
        }

        const payloadInput = payloadEnvelopes?.get(slot);
        if (payloadInput?.hasPayloadEnvelope()) {
          if (!payloadInput.isComplete()) {
            throw new Error(`Payload envelope for slot ${slot} not complete after DA verification`);
          }
          const payloadDA = payloadDAStatuses.get(slot);
          if (payloadDA === undefined) {
            throw new Error(`Missing payload DA status for slot ${slot}`);
          }
          await importExecutionPayload.call(this, payloadInput, payloadDA, {validSignature: false});
        }

        await nextEventLoop();
      }
    } finally {
      this.beaconEngine.discardVerifiedBlocks(verifiedBlockRoots);
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
