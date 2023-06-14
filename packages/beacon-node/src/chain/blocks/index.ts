import {WithOptionalBytes, allForks} from "@lodestar/types";
import {toHex, isErrorAborted} from "@lodestar/utils";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {BlockError, BlockErrorCode, isBlockErrorAborted} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import type {BeaconChain} from "../chain.js";
import {verifyBlocksInEpoch} from "./verifyBlock.js";
import {importBlock} from "./importBlock.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {BlockInput, FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {verifyBlocksSanityChecks} from "./verifyBlocksSanityChecks.js";
import {removeEagerlyPersistedBlockInputs} from "./writeBlockInputToDb.js";
export {ImportBlockOpts, AttestationImportOpt} from "./types.js";

const QUEUE_MAX_LENGTH = 256;

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<[WithOptionalBytes<BlockInput>[], ImportBlockOpts], void>;

  constructor(chain: BeaconChain, metrics: Metrics | null, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[WithOptionalBytes<BlockInput>[], ImportBlockOpts], void>(
      (job, importOpts) => {
        return processBlocks.call(chain, job, {...opts, ...importOpts});
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.blockProcessorQueue ?? undefined
    );
  }

  async processBlocksJob(job: WithOptionalBytes<BlockInput>[], opts: ImportBlockOpts = {}): Promise<void> {
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
  blocks: WithOptionalBytes<BlockInput>[],
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<void> {
  if (blocks.length === 0) {
    return; // TODO: or throw?
  } else if (blocks.length > 1) {
    assertLinearChainSegment(this.config, blocks);
  }

  try {
    const {relevantBlocks, dataAvailabilityStatuses, parentSlots, parentBlock} = verifyBlocksSanityChecks(
      this,
      blocks,
      opts
    );

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
      dataAvailabilityStatuses,
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
        blockInput: block,
        postState: postStates[i],
        parentBlockSlot: parentSlots[i],
        executionStatus: executionStatuses[i],
        // Currently dataAvailableStatus is not used upstream but that can change if we
        // start supporting optimistic syncing/processing
        dataAvailableStatus: dataAvailabilityStatuses[i],
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
    if (isErrorAborted(e) || isQueueErrorAborted(e) || isBlockErrorAborted(e)) {
      return; // Ignore
    }

    // above functions should only throw BlockError
    const err = getBlockError(e, blocks[0].block);

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

    // Clean db if we don't have blocks in forkchoice but already persisted them to db
    //
    // NOTE: this function is awaited to ensure that DB size remains constant, otherwise an attacker may bloat the
    // disk with big malicious payloads. Our sequential block importer will wait for this promise before importing
    // another block. The removal call error is not propagated since that would halt the chain.
    //
    // LOG: Because the error is not propagated and there's a risk of db bloat, the error is logged at warn level
    // to alert the user of potential db bloat. This error _should_ never happen user must act and report to us
    if (opts.eagerPersistBlock) {
      await removeEagerlyPersistedBlockInputs.call(this, blocks).catch((e) => {
        this.logger.warn(
          "Error pruning eagerly imported block inputs, DB may grow in size if this error happens frequently",
          {slot: blocks.map((block) => block.block.message.slot).join(",")},
          e
        );
      });
    }

    throw err;
  }
}

function getBlockError(e: unknown, block: allForks.SignedBeaconBlock): BlockError {
  if (e instanceof BlockError) {
    return e;
  } else if (e instanceof Error) {
    const blockError = new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e});
    blockError.stack = e.stack;
    return blockError;
  } else {
    return new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
  }
}
