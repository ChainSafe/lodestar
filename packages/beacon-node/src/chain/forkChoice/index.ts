import {ChainForkConfig} from "@lodestar/config";
import {
  ExecutionStatus,
  ForkChoice,
  ForkChoiceStore,
  JustifiedBalancesGetter,
  ProtoArray,
  ProtoBlock,
  ForkChoiceOpts as RawForkChoiceOpts,
} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateGloas,
  DataAvailabilityStatus,
  computeAnchorCheckpoint,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
  getEffectiveBalanceIncrementsZeroInactive,
  isExecutionStateType,
  isMergeTransitionComplete,
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
  state: CachedBeaconStateAllForks,
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
  state: CachedBeaconStateAllForks,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
  metrics: Metrics | null,
  logger?: Logger
): ForkChoice {
  const {blockHeader, checkpoint} = computeAnchorCheckpoint(config, state);
  const finalizedCheckpoint = {...checkpoint};
  const justifiedCheckpoint = {
    ...checkpoint,
    // If not genesis epoch, justified checkpoint epoch must be set to finalized checkpoint epoch + 1
    // So that we don't allow the chain to initially justify with a block that isn't also finalizing the anchor state.
    // If that happens, we will create an invalid head state,
    // with the head not matching the fork choice justified and finalized epochs.
    epoch: checkpoint.epoch === 0 ? checkpoint.epoch : checkpoint.epoch + 1,
  };

  const justifiedBalances = getEffectiveBalanceIncrementsZeroInactive(state);

  // forkchoiceConstructor is only used for some test cases
  // production code use ForkChoice constructor directly
  const forkchoiceConstructor = opts.forkchoiceConstructor ?? ForkChoice;

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

        ...(isExecutionStateType(state) && isMergeTransitionComplete(state)
          ? {
              executionPayloadBlockHash: toRootHex(state.latestExecutionPayloadHeader.blockHash),
              executionPayloadNumber: state.latestExecutionPayloadHeader.blockNumber,
              executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
            }
          : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),

        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
        ...(computeEpochAtSlot(blockHeader.slot) < state.config.GLOAS_FORK_EPOCH
          ? {
              builderIndex: undefined,
              blockHashHex: undefined,
            }
          : {
              builderIndex: (state as CachedBeaconStateGloas).latestExecutionPayloadBid.builderIndex,
              blockHashHex: toRootHex((state as CachedBeaconStateGloas).latestExecutionPayloadBid.blockHash),
            }),
      },
      currentSlot
    ),
    state.validators.length,
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
  unfinalizedState: CachedBeaconStateAllForks,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
  metrics: Metrics | null,
  logger?: Logger
): ForkChoice {
  const {blockHeader} = computeAnchorCheckpoint(config, unfinalizedState);
  const finalizedCheckpoint = unfinalizedState.finalizedCheckpoint.toValue();
  const justifiedCheckpoint = unfinalizedState.currentJustifiedCheckpoint.toValue();
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
  const justifiedBalances = getEffectiveBalanceIncrementsZeroInactive(unfinalizedState);
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

    ...(isExecutionStateType(unfinalizedState) && isMergeTransitionComplete(unfinalizedState)
      ? {
          executionPayloadBlockHash: toRootHex(unfinalizedState.latestExecutionPayloadHeader.blockHash),
          executionPayloadNumber: unfinalizedState.latestExecutionPayloadHeader.blockNumber,
          executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
        }
      : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),

    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    ...(computeEpochAtSlot(blockHeader.slot) < unfinalizedState.config.GLOAS_FORK_EPOCH
      ? {
          builderIndex: undefined,
          blockHashHex: undefined,
        }
      : {
          builderIndex: (unfinalizedState as CachedBeaconStateGloas).latestExecutionPayloadBid.builderIndex,
          blockHashHex: toRootHex((unfinalizedState as CachedBeaconStateGloas).latestExecutionPayloadBid.blockHash),
        }),
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
    targetRoot: toRootHex(getBlockRootAtSlot(unfinalizedState, computeStartSlotAtEpoch(parentEpoch))),
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
  protoArray.onBlock(justifiedBlock, currentSlot);
  protoArray.onBlock(parentBlock, currentSlot);
  protoArray.onBlock(headBlock, currentSlot);

  logger?.verbose("Initialized protoArray successfully", {...logCtx, length: protoArray.length()});

  // forkchoiceConstructor is only used for some test cases
  // production code use ForkChoice constructor directly
  const forkchoiceConstructor = opts.forkchoiceConstructor ?? ForkChoice;

  return new forkchoiceConstructor(
    config,
    store,
    protoArray,
    unfinalizedState.validators.length,
    metrics,
    opts,
    logger
  );
}
