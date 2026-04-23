import {ChainForkConfig} from "@lodestar/config";
import {
  ExecutionStatus,
  ForkChoice,
  ForkChoiceStore,
  JustifiedBalancesGetter,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
  ForkChoiceOpts as RawForkChoiceOpts,
} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isStatePostBellatrix,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Slot, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {GENESIS_SLOT} from "../../constants/index.js";
import {Metrics} from "../../metrics/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

export type ForkChoiceOpts = RawForkChoiceOpts & {
  // for testing only
  forkchoiceConstructor?: typeof ForkChoice;
};

export enum ForkchoiceCaller {
  prepareNextSlot = "prepare_next_slot",
  importBlock = "import_block",
}

/**
 * Fork Choice extended with a ChainEventEmitter
 */
export function initializeForkChoice(
  config: ChainForkConfig,
  emitter: ChainEventEmitter,
  currentSlot: Slot,
  state: IBeaconStateView,
  isFinalizedState: boolean,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
  metrics: Metrics | null,
  logger?: Logger
): ForkChoice {
  return isFinalizedState
    ? initializeForkChoiceFromFinalizedState(
        config,
        emitter,
        currentSlot,
        state,
        opts,
        justifiedBalancesGetter,
        metrics,
        logger
      )
    : initializeForkChoiceFromUnfinalizedState(
        config,
        emitter,
        currentSlot,
        state,
        opts,
        justifiedBalancesGetter,
        metrics,
        logger
      );
}

/**
 * Initialize forkchoice from a finalized state.
 */
export function initializeForkChoiceFromFinalizedState(
  config: ChainForkConfig,
  emitter: ChainEventEmitter,
  currentSlot: Slot,
  state: IBeaconStateView,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
  metrics: Metrics | null,
  logger?: Logger
): ForkChoice {
  const {blockHeader, checkpoint} = state.computeAnchorCheckpoint();
  const finalizedCheckpoint = {...checkpoint};
  const justifiedCheckpoint = {
    ...checkpoint,
    // If not genesis epoch, justified checkpoint epoch must be set to finalized checkpoint epoch + 1
    // So that we don't allow the chain to initially justify with a block that isn't also finalizing the anchor state.
    // If that happens, we will create an invalid head state,
    // with the head not matching the fork choice justified and finalized epochs.
    epoch: checkpoint.epoch === 0 ? checkpoint.epoch : checkpoint.epoch + 1,
  };

  const justifiedBalances = state.getEffectiveBalanceIncrementsZeroInactive();

  // forkchoiceConstructor is only used for some test cases
  // production code use ForkChoice constructor directly
  const forkchoiceConstructor = opts.forkchoiceConstructor ?? ForkChoice;

  const isForkPostGloas = computeEpochAtSlot(state.slot) >= config.GLOAS_FORK_EPOCH;

  return new forkchoiceConstructor(
    config,

    new ForkChoiceStore(
      currentSlot,
      justifiedCheckpoint,
      finalizedCheckpoint,
      justifiedBalances,
      justifiedBalancesGetter,
      {
        onJustified: (cp) => emitter.emit(ChainEvent.forkChoiceJustified, cp),
        onFinalized: (cp) => emitter.emit(ChainEvent.forkChoiceFinalized, cp),
      }
    ),

    ProtoArray.initialize(
      {
        slot: blockHeader.slot,
        parentRoot: toRootHex(blockHeader.parentRoot),
        stateRoot: toRootHex(blockHeader.stateRoot),
        blockRoot: toRootHex(checkpoint.root),
        timeliness: true, // Optimistically assume is timely

        justifiedEpoch: justifiedCheckpoint.epoch,
        justifiedRoot: toRootHex(justifiedCheckpoint.root),
        finalizedEpoch: finalizedCheckpoint.epoch,
        finalizedRoot: toRootHex(finalizedCheckpoint.root),
        unrealizedJustifiedEpoch: justifiedCheckpoint.epoch,
        unrealizedJustifiedRoot: toRootHex(justifiedCheckpoint.root),
        unrealizedFinalizedEpoch: finalizedCheckpoint.epoch,
        unrealizedFinalizedRoot: toRootHex(finalizedCheckpoint.root),

        ...(isStatePostBellatrix(state) && state.isExecutionStateType && state.isMergeTransitionComplete
          ? {
              executionPayloadBlockHash: isStatePostGloas(state)
                ? toRootHex(state.latestBlockHash)
                : toRootHex(state.latestExecutionPayloadHeader.blockHash),
              // TODO GLOAS: executionPayloadNumber is not tracked in BeaconState post-gloas (EIP-7732 removed
              // latestExecutionPayloadHeader). Using 0 as unavailable fallback until a solution is found.
              executionPayloadNumber: isStatePostGloas(state) ? 0 : state.payloadBlockNumber,
              executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
            }
          : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),

        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
        payloadStatus: isForkPostGloas ? PayloadStatus.PENDING : PayloadStatus.FULL, // TODO GLOAS: Post-gloas how do we know if the checkpoint payload is FULL or EMPTY?
        parentBlockHash: isStatePostGloas(state) ? toRootHex(state.latestBlockHash) : null,
      },
      currentSlot
    ),
    state.validatorCount,
    metrics,
    opts,
    logger
  );
}

/**
 * Initialize forkchoice from an unfinalized state.
 */
export function initializeForkChoiceFromUnfinalizedState(
  config: ChainForkConfig,
  emitter: ChainEventEmitter,
  currentSlot: Slot,
  unfinalizedState: IBeaconStateView,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
  metrics: Metrics | null,
  logger?: Logger
): ForkChoice {
  const {blockHeader} = unfinalizedState.computeAnchorCheckpoint();
  const finalizedCheckpoint = unfinalizedState.finalizedCheckpoint;
  const justifiedCheckpoint = unfinalizedState.currentJustifiedCheckpoint;
  const headRoot = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader));

  const logCtx = {
    currentSlot: currentSlot,
    stateSlot: unfinalizedState.slot,
    headSlot: blockHeader.slot,
    headRoot: headRoot,
    finalizedEpoch: finalizedCheckpoint.epoch,
    finalizedRoot: toRootHex(finalizedCheckpoint.root),
    justifiedEpoch: justifiedCheckpoint.epoch,
    justifiedRoot: toRootHex(justifiedCheckpoint.root),
  };
  logger?.warn("Initializing fork choice from unfinalized state", logCtx);

  // this is not the justified state, but there is no other ways to get justified balances
  const justifiedBalances = unfinalizedState.getEffectiveBalanceIncrementsZeroInactive();

  const isForkPostGloas = computeEpochAtSlot(unfinalizedState.slot) >= config.GLOAS_FORK_EPOCH;

  const store = new ForkChoiceStore(
    currentSlot,
    justifiedCheckpoint,
    finalizedCheckpoint,
    justifiedBalances,
    justifiedBalancesGetter,
    {
      onJustified: (cp) => emitter.emit(ChainEvent.forkChoiceJustified, cp),
      onFinalized: (cp) => emitter.emit(ChainEvent.forkChoiceFinalized, cp),
    }
  );

  // this is the same to the finalized state
  const headBlock: ProtoBlock = {
    slot: blockHeader.slot,
    parentRoot: toRootHex(blockHeader.parentRoot),
    stateRoot: toRootHex(blockHeader.stateRoot),
    blockRoot: headRoot,
    targetRoot: headRoot,
    timeliness: true, // Optimistically assume is timely

    justifiedEpoch: justifiedCheckpoint.epoch,
    justifiedRoot: toRootHex(justifiedCheckpoint.root),
    finalizedEpoch: finalizedCheckpoint.epoch,
    finalizedRoot: toRootHex(finalizedCheckpoint.root),
    unrealizedJustifiedEpoch: justifiedCheckpoint.epoch,
    unrealizedJustifiedRoot: toRootHex(justifiedCheckpoint.root),
    unrealizedFinalizedEpoch: finalizedCheckpoint.epoch,
    unrealizedFinalizedRoot: toRootHex(finalizedCheckpoint.root),

    ...(isStatePostBellatrix(unfinalizedState) &&
    unfinalizedState.isExecutionStateType &&
    unfinalizedState.isMergeTransitionComplete
      ? {
          executionPayloadBlockHash: isStatePostGloas(unfinalizedState)
            ? toRootHex(unfinalizedState.latestBlockHash)
            : toRootHex(unfinalizedState.latestExecutionPayloadHeader.blockHash),
          // TODO GLOAS: executionPayloadNumber is not tracked in BeaconState post-gloas (EIP-7732 removed
          // latestExecutionPayloadHeader). Using 0 as unavailable fallback until a solution is found.
          executionPayloadNumber: isStatePostGloas(unfinalizedState) ? 0 : unfinalizedState.payloadBlockNumber,
          executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
        }
      : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),

    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    payloadStatus: isForkPostGloas ? PayloadStatus.PENDING : PayloadStatus.FULL, // TODO GLOAS: Post-gloas how do we know if the checkpoint payload is FULL or EMPTY?
    parentBlockHash: isStatePostGloas(unfinalizedState) ? toRootHex(unfinalizedState.latestBlockHash) : null,
  };

  const parentSlot = blockHeader.slot - 1;
  const parentEpoch = computeEpochAtSlot(parentSlot);
  // parent of head block
  const parentBlock: ProtoBlock = {
    ...headBlock,
    slot: parentSlot,
    // link this to the dummy justified block
    parentRoot: toRootHex(justifiedCheckpoint.root),
    // dummy data, we're not able to regen state before headBlock
    stateRoot: ZERO_HASH_HEX,
    blockRoot: headBlock.parentRoot,
    targetRoot: toRootHex(unfinalizedState.getBlockRootAtSlot(computeStartSlotAtEpoch(parentEpoch))),
  };

  const justifiedBlock: ProtoBlock = {
    ...headBlock,
    slot: computeStartSlotAtEpoch(justifiedCheckpoint.epoch),
    // link this to the finalized root so that getAncestors can find the finalized block
    parentRoot: toRootHex(finalizedCheckpoint.root),
    // dummy data, we're not able to regen state before headBlock
    stateRoot: ZERO_HASH_HEX,
    blockRoot: toRootHex(justifiedCheckpoint.root),
    // same to blockRoot
    targetRoot: toRootHex(justifiedCheckpoint.root),
  };

  const finalizedBlock: ProtoBlock = {
    ...headBlock,
    slot: computeStartSlotAtEpoch(finalizedCheckpoint.epoch),
    // we don't care parent of finalized block
    parentRoot: ZERO_HASH_HEX,
    // dummy data, we're not able to regen state before headBlock
    stateRoot: ZERO_HASH_HEX,
    blockRoot: toRootHex(finalizedCheckpoint.root),
    // same to blockRoot
    targetRoot: toRootHex(finalizedCheckpoint.root),
  };

  const protoArray = ProtoArray.initialize(finalizedBlock, currentSlot);
  protoArray.onBlock(justifiedBlock, currentSlot, null);
  protoArray.onBlock(parentBlock, currentSlot, null);
  protoArray.onBlock(headBlock, currentSlot, null);

  logger?.verbose("Initialized protoArray successfully", {...logCtx, length: protoArray.length()});

  // forkchoiceConstructor is only used for some test cases
  // production code use ForkChoice constructor directly
  const forkchoiceConstructor = opts.forkchoiceConstructor ?? ForkChoice;

  return new forkchoiceConstructor(config, store, protoArray, unfinalizedState.validatorCount, metrics, opts, logger);
}
