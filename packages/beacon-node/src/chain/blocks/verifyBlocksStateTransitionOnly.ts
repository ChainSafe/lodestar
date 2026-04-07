import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  IBeaconStateViewGloas,
  StateHashTreeRootSource,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Slot, isGloasBeaconBlock} from "@lodestar/types";
import {ErrorAborted, Logger, byteArrayEquals, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {IBlockInput} from "./blockInput/index.js";
import {PayloadEnvelopeInput} from "./payloadEnvelopeInput/payloadEnvelopeInput.js";
import {ImportBlockOpts} from "./types.js";

/**
 * Verifies 1 or more blocks/envelopes are fully valid running the full state transition; from a linear sequence of blocks/envelopes.
 *
 * - Advance state to block's slot - per_slot_processing()
 * - For each block:
 *   - STFN - per_block_processing()
 *   - Check state root matches
 *   - For gloas blocks with an envelope: run processExecutionPayloadEnvelope() and check envelope state root
 *   - Pre-state selection for gloas: use post-envelope state of previous block if proposer built on FULL path
 *     (bid.parentBlockHash matches previous envelope payload.blockHash), otherwise use post-block state
 */
export async function verifyBlocksStateTransitionOnly(
  preState0: IBeaconStateView,
  blocks: IBlockInput[],
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
  dataAvailabilityStatuses: DataAvailabilityStatus[],
  logger: Logger,
  metrics: Metrics | null,
  validatorMonitor: ValidatorMonitor | null,
  signal: AbortSignal,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{
  postBlockStates: IBeaconStateView[];
  proposerBalanceDeltas: number[];
  verifyStateTime: number;
  postPayloadStates: Map<
    Slot,
    {postPayloadState: IBeaconStateViewGloas; payloadEnvelopeInput: PayloadEnvelopeInput} | null
  >;
}> {
  const postBlockStates: IBeaconStateView[] = [];
  const proposerBalanceDeltas: number[] = [];
  const postPayloadStates = new Map<
    Slot,
    {postPayloadState: IBeaconStateViewGloas; payloadEnvelopeInput: PayloadEnvelopeInput} | null
  >();
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);

  for (let i = 0; i < blocks.length; i++) {
    const {validProposerSignature, validSignatures} = opts;
    const block = blocks[i].getBlock();
    const dataAvailabilityStatus = dataAvailabilityStatuses[i];

    let preState: IBeaconStateView;
    if (i === 0) {
      preState = preState0;
    } else {
      const prevSlot = blocks[i - 1].getBlock().message.slot;
      const prevEnvelopeResult = postPayloadStates.get(prevSlot) ?? null;
      // If previous slot had an envelope and its latestBlockHash matches
      // this block's bid parentBlockHash, the proposer built on the FULL path
      if (
        prevEnvelopeResult != null &&
        isGloasBeaconBlock(block.message) &&
        byteArrayEquals(
          prevEnvelopeResult.postPayloadState.latestBlockHash,
          block.message.body.signedExecutionPayloadBid.message.parentBlockHash
        )
      ) {
        // gloas FULL path - use post-envelope state of previous block as pre-state for this block
        preState = prevEnvelopeResult.postPayloadState;
      } else {
        // EMPTY path or pre-gloas block
        if (prevEnvelopeResult != null && isGloasBeaconBlock(block.message)) {
          // the envelope is orphaned
          logger.debug("Previous block had an execution payload envelope but this block did not build on it", {
            slot: block.message.slot,
            prevEnvelopeBlockHash: toRootHex(prevEnvelopeResult.postPayloadState.latestBlockHash),
            currentBidParentHash: toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash),
          });
        }
        preState = postBlockStates[i - 1];
      }
    }

    // STFN - per_slot_processing() + per_block_processing()
    // NOTE: `regen.getPreState()` should have dialed forward the state already caching checkpoint states
    const useBlsBatchVerify = !opts?.disableBlsBatchVerify;
    const postBlockState = preState.stateTransition(
      block,
      {
        // NOTE: Assume valid for now while sending payload to execution engine in parallel
        // Latter verifyBlocksInEpoch() will make sure that payload is indeed valid
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus,
        // false because it's verified below with better error typing
        verifyStateRoot: false,
        // if block is trusted don't verify proposer or op signature
        verifyProposer: !useBlsBatchVerify && !validSignatures && !validProposerSignature,
        verifySignatures: !useBlsBatchVerify && !validSignatures,
        dontTransferCache: false,
      },
      {metrics, validatorMonitor}
    );

    const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
      source: StateHashTreeRootSource.blockTransition,
    });
    const stateRootAfterStateTransition = postBlockState.hashTreeRoot();
    hashTreeRootTimer?.();

    // Check state root matches
    if (!byteArrayEquals(block.message.stateRoot, stateRootAfterStateTransition)) {
      throw new BlockError(block, {
        code: BlockErrorCode.INVALID_BLOCK_STATE_ROOT,
        root: postBlockState.hashTreeRoot(),
        expectedRoot: block.message.stateRoot,
        preState,
        postState: postBlockState,
      });
    }

    // If blocks are invalid in execution the main promise could resolve before this loop ends.
    // In that case stop processing blocks and return early.
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockStateTransitionOnly");
    }

    postBlockStates[i] = postBlockState;

    // For metric block profitability
    const proposerIndex = block.message.proposerIndex;
    proposerBalanceDeltas[i] = postBlockState.getBalance(proposerIndex) - preState.getBalance(proposerIndex);

    const slot = block.message.slot;
    const payloadEnvelopeInput = payloadEnvelopes?.get(slot) ?? null;
    const payloadEnvelope = payloadEnvelopeInput?.hasPayloadEnvelope()
      ? payloadEnvelopeInput.getPayloadEnvelope()
      : null;
    if (payloadEnvelope !== null && isStatePostGloas(postBlockState)) {
      // verifyStateRoot: false — we verify manually below with BlockError for proper error typing
      const postPayloadState = postBlockState.processExecutionPayloadEnvelope(payloadEnvelope, {
        verifySignature: false,
        verifyStateRoot: false,
      });

      const hashTreeRootTimerEnvelope = metrics?.stateHashTreeRootTime.startTimer({
        source: StateHashTreeRootSource.envelopeTransition,
      });
      const stateRootAfterEnvelope = postPayloadState.hashTreeRoot();
      hashTreeRootTimerEnvelope?.();

      if (!byteArrayEquals(payloadEnvelope.message.stateRoot, stateRootAfterEnvelope)) {
        throw new BlockError(block, {
          code: BlockErrorCode.INVALID_PAYLOAD_STATE_ROOT,
          root: stateRootAfterEnvelope,
          expectedRoot: payloadEnvelope.message.stateRoot,
          preState: postBlockState,
          postState: postPayloadState,
        });
      }

      if (payloadEnvelopeInput === null) {
        // should not happen
        throw Error("Expected PayloadEnvelopeInput");
      }

      postPayloadStates.set(slot, {postPayloadState: postPayloadState as IBeaconStateViewGloas, payloadEnvelopeInput});
    } else {
      postPayloadStates.set(slot, null);
    }

    // If blocks are invalid in execution the main promise could resolve before this loop ends.
    // In that case stop processing blocks and return early.
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockStateTransitionOnly");
    }

    // this avoids keeping our node busy processing blocks
    if (i < blocks.length - 1) {
      await nextEventLoop();
    }
  }

  const verifyStateTime = Date.now();
  if (blocks.length === 1 && opts.seenTimestampSec !== undefined) {
    const slot = blocks[0].getBlock().message.slot;
    const recvToValidation = verifyStateTime / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    metrics?.gossipBlock.stateTransition.recvToValidation.observe(recvToValidation);
    metrics?.gossipBlock.stateTransition.validationTime.observe(validationTime);

    logger.debug("Verified block state transition", {slot, recvToValLatency, recvToValidation, validationTime});
  }

  return {postBlockStates, proposerBalanceDeltas, verifyStateTime, postPayloadStates};
}
