import {toHexString} from "@chainsafe/ssz";
import {Slot} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {
  ForkChoice,
  ProtoArray,
  ForkChoiceStore,
  ExecutionStatus,
  JustifiedBalancesGetter,
  ForkChoiceOpts as RawForkChoiceOpts,
  DataAvailabilityStatus,
} from "@lodestar/fork-choice";
import {
  CachedBeaconStateAllForks,
  getEffectiveBalanceIncrementsZeroInactive,
  isExecutionStateType,
  isMergeTransitionComplete,
} from "@lodestar/state-transition";

import {Logger, toRootHex} from "@lodestar/utils";
import {computeAnchorCheckpoint} from "../initState.js";
import {ChainEventEmitter} from "../emitter.js";
import {ChainEvent} from "../emitter.js";
import {GENESIS_SLOT} from "../../constants/index.js";

export type ForkChoiceOpts = RawForkChoiceOpts & {
  // for testing only
  forkchoiceConstructor?: typeof ForkChoice;
};

/**
 * Fork Choice extended with a ChainEventEmitter
 */
export function initializeForkChoice(
  config: ChainForkConfig,
  emitter: ChainEventEmitter,
  currentSlot: Slot,
  state: CachedBeaconStateAllForks,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter,
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
        timeliness: true, // Optimisitcally assume is timely

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
              executionPayloadBlockHash: toHexString(state.latestExecutionPayloadHeader.blockHash),
              executionPayloadNumber: state.latestExecutionPayloadHeader.blockNumber,
              executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
            }
          : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),

        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      },
      currentSlot
    ),
    opts,
    logger
  );
}
