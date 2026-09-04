import {PayloadStatus} from "@lodestar/fork-choice";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SignedBeaconBlock, Slot} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {BlockError, BlockErrorCode, isBlockErrorAborted} from "../errors/index.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {BlockProcessOpts} from "../options.js";
import {IBlockInput} from "./blockInput/types.js";
import {FORK_CHOICE_ATT_EPOCH_LIMIT, importBlock} from "./importBlock.js";
import {PayloadError, importExecutionPayload} from "./importExecutionPayload.js";
import {PayloadEnvelopeInput} from "./payloadEnvelopeInput/payloadEnvelopeInput.js";
import {AttestationImportOpt, FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {verifyBlocksInEpoch} from "./verifyBlock.js";
import {verifyBlocksSanityChecks} from "./verifyBlocksSanityChecks.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

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
      await importPayloadEnvelopesOfKnownBlocks.call(this, payloadEnvelopes);
      return;
    }

    const {warnings: orphanedPayloads} = assertLinearChainSegment(
      this.config,
      relevantBlocks,
      payloadEnvelopes,
      parentBlock
    );
    // Same condition as importBlock() for importing the block's attestations into fork choice. Without them an
    // orphaned payload is a FULL variant without descendants that ties at zero weight with the EMPTY variant
    // carrying the chain and wins the payload status tiebreaker, parking the head. With attestations weight decides.
    const blockEpoch = computeEpochAtSlot(relevantBlocks[0].getBlock().message.slot);
    const importsAttestations =
      opts.importAttestations === AttestationImportOpt.Force ||
      (opts.importAttestations !== AttestationImportOpt.Skip &&
        blockEpoch >= this.clock.currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT);
    let payloadEnvelopesToImport = payloadEnvelopes;
    if (orphanedPayloads != null && payloadEnvelopes !== null && !importsAttestations) {
      payloadEnvelopesToImport = new Map(payloadEnvelopes);
      for (const orphaned of orphanedPayloads) {
        payloadEnvelopesToImport.delete(orphaned.slot);
        // never validated, drop it from the shared cache so gossip or by-root can still deliver a valid one
        this.seenPayloadEnvelopeInputCache.prune(orphaned.payloadEnvelopeInput.blockRootHex);
        this.logger.debug("Skipping orphaned payload envelope in chain segment", {
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
    } = await verifyBlocksInEpoch.call(this, parentBlock, relevantBlocks, payloadEnvelopesToImport, opts);

    // If segmentExecStatus has lvhForkchoice then, the entire segment should be invalid
    // and we need to further propagate
    if (segmentExecStatus.execAborted !== null) {
      if (segmentExecStatus.invalidSegmentLVH !== undefined) {
        this.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLVH);
      }
      throw segmentExecStatus.execAborted.execError;
    }

    for (const blockInput of relevantBlocks) {
      const block = blockInput.getBlock().message;
      this.seenBlockProposers.add(block.slot, block.proposerIndex, blockInput.blockRootHex);
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

    const slotSet = new Set<Slot>(blocks.map((b) => b.getBlock().message.slot));
    if (payloadEnvelopesToImport) {
      for (const slot of payloadEnvelopesToImport.keys()) slotSet.add(slot);
    }
    const slots = Array.from(slotSet).sort((a, b) => a - b);
    for (const slot of slots) {
      const fullyVerifiedBlock = verifiedBlocksBySlot.get(slot);
      if (fullyVerifiedBlock !== undefined) {
        // TODO: Consider batching importBlock too if it takes significant time
        await importBlock.call(this, fullyVerifiedBlock, opts);
      }

      // PayloadEnvelopeInput is shared and may receive an envelope after the DA snapshot was taken.
      const payloadDA = payloadDAStatuses.get(slot);
      if (payloadDA !== undefined) {
        const payloadInput = payloadEnvelopesToImport?.get(slot);
        if (payloadInput === undefined) {
          throw new Error(`Missing payload input for slot ${slot} after DA verification`);
        }
        if (!payloadInput.isComplete()) {
          // we validated DA before reaching this
          throw new Error(`Payload envelope for slot ${slot} not complete after DA verification`);
        }
        await importExecutionPayload.call(this, payloadInput, payloadDA, {validSignature: false});
      }

      await nextEventLoop();
    }
  } catch (e) {
    if (isErrorAborted(e) || isQueueErrorAborted(e) || isBlockErrorAborted(e)) {
      return; // Ignore
    }

    // above functions should only throw BlockError, or PayloadError from the gloas payload import
    const err = getBlockOrPayloadError(e, blocks[0].getBlock());

    // TODO: De-duplicate with logic above
    // ChainEvent.errorBlock
    if (!(err instanceof BlockError) && !(err instanceof PayloadError)) {
      this.logger.debug("Neither BlockError nor PayloadError received", {}, err);
    } else if (err instanceof PayloadError) {
      if (!opts.disableOnBlockError) {
        this.logger.debug(
          "Payload error",
          {slot: err.payloadInput.slot, blockRoot: err.payloadInput.blockRootHex},
          err
        );
      }
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

/**
 * A peer can serve a block without its envelope, the block is then imported with a PENDING payload. Later batches
 * carry the envelope but all their blocks are known, without importing it here every child building on the FULL
 * variant fails with PARENT_PAYLOAD_UNKNOWN and range sync never progresses. If our head already descends from the
 * block's EMPTY variant the chain did not build on the payload, importing it would only add a dead FULL leaf.
 */
async function importPayloadEnvelopesOfKnownBlocks(
  this: BeaconChain,
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null
): Promise<void> {
  if (payloadEnvelopes === null) {
    return;
  }

  const head = this.forkChoice.getHead();
  const payloadInputs: PayloadEnvelopeInput[] = [];
  for (const payloadInput of payloadEnvelopes.values()) {
    const {blockRootHex} = payloadInput;
    if (
      !payloadInput.hasPayloadEnvelope() ||
      !this.forkChoice.hasBlockHex(blockRootHex) ||
      this.forkChoice.getBlockHexAndBlockHash(blockRootHex, payloadInput.getBlockHashHex()) !== null ||
      (head.blockRoot !== blockRootHex &&
        this.forkChoice.isDescendant(blockRootHex, PayloadStatus.EMPTY, head.blockRoot, head.payloadStatus))
    ) {
      continue;
    }
    payloadInputs.push(payloadInput);
  }

  if (payloadInputs.length === 0) {
    return;
  }

  const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability(payloadInputs, new AbortController().signal);
  for (let i = 0; i < payloadInputs.length; i++) {
    this.logger.debug("Importing payload envelope of known block", {
      slot: payloadInputs[i].slot,
      blockRoot: payloadInputs[i].blockRootHex,
    });
    await importExecutionPayload.call(this, payloadInputs[i], dataAvailabilityStatuses[i], {validSignature: false});
  }
  // the new FULL variants are not seen by the head cached from the last block import
  this.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
}

function getBlockOrPayloadError(e: unknown, block: SignedBeaconBlock): BlockError | PayloadError {
  if (e instanceof BlockError) {
    return e;
  }

  if (e instanceof PayloadError) {
    return e;
  }

  if (e instanceof Error) {
    const blockError = new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e});
    blockError.stack = e.stack;
    return blockError;
  }

  return new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
}
