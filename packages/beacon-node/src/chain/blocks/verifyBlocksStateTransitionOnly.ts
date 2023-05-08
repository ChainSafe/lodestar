import {
  CachedBeaconStateAllForks,
  stateTransition,
  ExecutionPayloadStatus,
  DataAvailableStatus,
} from "@lodestar/state-transition";
import {ErrorAborted, Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {BlockInput, ImportBlockOpts} from "./types.js";

/**
 * Verifies 1 or more blocks are fully valid running the full state transition; from a linear sequence of blocks.
 *
 * - Advance state to block's slot - per_slot_processing()
 * - For each block:
 *   - STFN - per_block_processing()
 *   - Check state root matches
 */
export async function verifyBlocksStateTransitionOnly(
  preState0: CachedBeaconStateAllForks,
  blocks: BlockInput[],
  dataAvailabilityStatuses: DataAvailableStatus[],
  logger: Logger,
  metrics: Metrics | null,
  signal: AbortSignal,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{postStates: CachedBeaconStateAllForks[]; proposerBalanceDeltas: number[]}> {
  const postStates: CachedBeaconStateAllForks[] = [];
  const proposerBalanceDeltas: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const {validProposerSignature, validSignatures} = opts;
    const {block} = blocks[i];
    const preState = i === 0 ? preState0 : postStates[i - 1];
    const dataAvailableStatus = dataAvailabilityStatuses[i];

    // STFN - per_slot_processing() + per_block_processing()
    // NOTE: `regen.getPreState()` should have dialed forward the state already caching checkpoint states
    const useBlsBatchVerify = !opts?.disableBlsBatchVerify;
    const postState = stateTransition(
      preState,
      block,
      {
        // NOTE: Assume valid for now while sending payload to execution engine in parallel
        // Latter verifyBlocksInEpoch() will make sure that payload is indeed valid
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailableStatus,
        // false because it's verified below with better error typing
        verifyStateRoot: false,
        // if block is trusted don't verify proposer or op signature
        verifyProposer: !useBlsBatchVerify && !validSignatures && !validProposerSignature,
        verifySignatures: !useBlsBatchVerify && !validSignatures,
      },
      metrics
    );

    const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer();
    const stateRoot = postState.hashTreeRoot();
    hashTreeRootTimer?.();

    // Check state root matches
    if (!byteArrayEquals(block.message.stateRoot, stateRoot)) {
      throw new BlockError(block, {
        code: BlockErrorCode.INVALID_STATE_ROOT,
        root: postState.hashTreeRoot(),
        expectedRoot: block.message.stateRoot,
        preState,
        postState,
      });
    }

    postStates[i] = postState;

    // For metric block profitability
    const proposerIndex = block.message.proposerIndex;
    proposerBalanceDeltas[i] = postState.balances.get(proposerIndex) - preState.balances.get(proposerIndex);

    // If blocks are invalid in execution the main promise could resolve before this loop ends.
    // In that case stop processing blocks and return early.
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockStateTransitionOnly");
    }

    // this avoids keeping our node busy processing blocks
    if (i < blocks.length - 1) {
      await sleep(0);
    }
  }

  if (blocks.length === 1 && opts.seenTimestampSec !== undefined) {
    const slot = blocks[0].block.message.slot;
    const recvToTransition = Date.now() / 1000 - opts.seenTimestampSec;
    metrics?.gossipBlock.receivedToStateTransition.observe(recvToTransition);
    logger.verbose("Transitioned gossip block", {slot, recvToTransition});
  }

  return {postStates, proposerBalanceDeltas};
}
