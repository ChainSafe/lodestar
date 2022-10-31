import {toHexString} from "@chainsafe/ssz";
import {Slot} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {
  ForkChoice,
  ProtoArray,
  ForkChoiceStore,
  ExecutionStatus,
  JustifiedBalancesGetter,
  ForkChoiceOpts,
} from "@lodestar/fork-choice";
import {
  CachedBeaconStateAllForks,
  getEffectiveBalanceIncrementsZeroInactive,
  isExecutionStateType,
  isMergeTransitionComplete,
} from "@lodestar/state-transition";

import {computeAnchorCheckpoint} from "../initState.js";
import {ChainEventEmitter} from "../emitter.js";
import {ChainEvent} from "../emitter.js";
import {GENESIS_SLOT} from "../../constants/index.js";

export {ForkChoiceOpts};

/**
 * Fork Choice extended with a ChainEventEmitter
 */
export function initializeForkChoice(
  config: IChainForkConfig,
  emitter: ChainEventEmitter,
  currentSlot: Slot,
  state: CachedBeaconStateAllForks,
  opts: ForkChoiceOpts,
  justifiedBalancesGetter: JustifiedBalancesGetter
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

  return new ForkChoice(
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
        parentRoot: toHexString(blockHeader.parentRoot),
        stateRoot: toHexString(blockHeader.stateRoot),
        blockRoot: toHexString(checkpoint.root),

        justifiedEpoch: justifiedCheckpoint.epoch,
        justifiedRoot: toHexString(justifiedCheckpoint.root),
        finalizedEpoch: finalizedCheckpoint.epoch,
        finalizedRoot: toHexString(finalizedCheckpoint.root),
        unrealizedJustifiedEpoch: justifiedCheckpoint.epoch,
        unrealizedJustifiedRoot: toHexString(justifiedCheckpoint.root),
        unrealizedFinalizedEpoch: finalizedCheckpoint.epoch,
        unrealizedFinalizedRoot: toHexString(finalizedCheckpoint.root),

        ...(isExecutionStateType(state) && isMergeTransitionComplete(state)
          ? {
              executionPayloadBlockHash: toHexString(state.latestExecutionPayloadHeader.blockHash),
              executionStatus: blockHeader.slot === GENESIS_SLOT ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
            }
          : {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}),
      },
      currentSlot
    ),

    opts
  );
}
