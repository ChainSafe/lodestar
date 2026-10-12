import {BeaconConfig} from "@lodestar/config";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  StateHashTreeRootSource,
} from "@lodestar/state-transition";
import {SignedBeaconBlock} from "@lodestar/types";
import {ErrorAborted, Logger, byteArrayEquals, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {IBeaconEngineOptions} from "../beaconEngine/options.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {ImportBlockOpts} from "./types.js";
import {persistInvalidSszObject} from "./utils/persistInvalidSszObject.js";

/**
 * Verifies 1 or more blocks are fully valid running the full state transition; from a linear sequence of blocks.
 *
 * - Advance state to block's slot - per_slot_processing()
 * - For each block:
 *   - STFN - per_block_processing()
 *   - Check state root matches
 */
export async function verifyBlocksStateTransitionOnly(
  config: BeaconConfig,
  preState0: IBeaconStateView,
  blocks: SignedBeaconBlock[],
  dataAvailabilityStatuses: DataAvailabilityStatus[],
  blockBytes: Uint8Array[],
  logger: Logger,
  metrics: Metrics | null,
  validatorMonitor: ValidatorMonitor | null,
  signal: AbortSignal,
  // Persist config read off `IBeaconEngineOptions` (engine-owned); persisting the pre/post state bytes here
  // (engine-side) keeps `IBeaconStateView` off the thrown `BlockError` (out of the facade seam).
  opts: BlockProcessOpts &
    ImportBlockOpts &
    Pick<IBeaconEngineOptions, "persistInvalidSszObjects" | "persistInvalidSszObjectsDir">
): Promise<{postStates: IBeaconStateView[]; proposerBalanceDeltas: number[]; verifyStateTime: number}> {
  const postStates: IBeaconStateView[] = [];
  const proposerBalanceDeltas: number[] = [];
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);

  for (let i = 0; i < blocks.length; i++) {
    if (signal.aborted) throw new ErrorAborted("verifyBlockStateTransitionOnly");
    const {validProposerSignature, validSignatures} = opts;
    const block = blocks[i];
    const preState = i === 0 ? preState0 : postStates[i - 1];
    const dataAvailabilityStatus = dataAvailabilityStatuses[i];

    // STFN - per_slot_processing() + per_block_processing()
    // NOTE: `regen.getPreState()` should have dialed forward the state already caching checkpoint states
    const useBlsBatchVerify = !opts?.disableBlsBatchVerify;
    let postState: IBeaconStateView;
    try {
      postState = preState.stateTransition(
        {block, ssz: blockBytes[i]},
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
        {metrics: metrics?.stateTransition, validatorMonitor}
      );
    } catch (e) {
      throw new BlockError(block, {
        code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR,
        blockRoot: toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
        error: e as Error,
      });
    }

    const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
      source: StateHashTreeRootSource.blockTransition,
    });
    const stateRoot = postState.hashTreeRoot();
    hashTreeRootTimer?.();

    // Check state root matches
    if (!byteArrayEquals(block.message.stateRoot, stateRoot)) {
      // Invalid state root is critical and often stalls the node; persist block + pre/post state for investigation.
      if (opts.persistInvalidSszObjects) {
        const dir = opts.persistInvalidSszObjectsDir ?? "invalid_ssz_objects";
        const logStr = `slot_${block.message.slot}_invalid_state_root_${toRootHex(stateRoot)}`;
        const blockType = config.getForkTypes(block.message.slot).SignedBeaconBlock;
        void persistInvalidSszObject(
          dir,
          logger,
          `SignedBeaconBlock_slot_${block.message.slot}`,
          blockType.serialize(block),
          blockType.hashTreeRoot(block),
          `${logStr}_block`
        );
        void persistInvalidSszObject(
          dir,
          logger,
          `preState_slot_${preState.slot}_BeaconState`,
          preState.serialize(),
          preState.hashTreeRoot(),
          `${logStr}_pre_state`
        );
        void persistInvalidSszObject(
          dir,
          logger,
          `postState_slot_${postState.slot}_BeaconState`,
          postState.serialize(),
          postState.hashTreeRoot(),
          `${logStr}_post_state`
        );
      }
      throw new BlockError(block, {
        code: BlockErrorCode.INVALID_STATE_ROOT,
        root: stateRoot,
        expectedRoot: block.message.stateRoot,
      });
    }

    postStates[i] = postState;

    // For metric block profitability
    const proposerIndex = block.message.proposerIndex;
    proposerBalanceDeltas[i] = postState.getBalance(proposerIndex) - preState.getBalance(proposerIndex);

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
    const slot = blocks[0].message.slot;
    const recvToValidation = verifyStateTime / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    metrics?.gossipBlock.stateTransition.recvToValidation.observe(recvToValidation);
    metrics?.gossipBlock.stateTransition.validationTime.observe(validationTime);

    logger.debug("Verified block state transition", {slot, recvToValLatency, recvToValidation, validationTime});
  }

  return {postStates, proposerBalanceDeltas, verifyStateTime};
}
