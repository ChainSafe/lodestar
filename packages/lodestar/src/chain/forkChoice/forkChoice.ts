/**
 * @module chain/forkChoice
 */

import {toHexString} from "@chainsafe/ssz";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ForkChoice, ProtoArray} from "@chainsafe/lodestar-fork-choice";

import {computeAnchorCheckpoint} from "../initState";
import {ChainEventEmitter} from "../emitter";
import {ForkChoiceStore} from "./store";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IMetrics} from "../../metrics";
import {getEffectiveBalances} from "../../util/beaconStateTransition";

/**
 * Fork Choice extended with a ChainEventEmitter
 */
export class LodestarForkChoice extends ForkChoice {
  constructor({
    config,
    emitter,
    currentSlot,
    state,
    metrics,
  }: {
    config: IChainForkConfig;
    emitter: ChainEventEmitter;
    currentSlot: Slot;
    state: CachedBeaconState<allForks.BeaconState>;
    metrics?: IMetrics | null;
  }) {
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
    const justifiedBalances = getEffectiveBalances(state);

    super({
      config,

      fcStore: new ForkChoiceStore({
        emitter,
        currentSlot,
        justifiedCheckpoint,
        finalizedCheckpoint,
      }),

      protoArray: ProtoArray.initialize({
        slot: blockHeader.slot,
        parentRoot: toHexString(blockHeader.parentRoot),
        stateRoot: toHexString(blockHeader.stateRoot),
        blockRoot: toHexString(checkpoint.root),
        justifiedEpoch: justifiedCheckpoint.epoch,
        finalizedEpoch: finalizedCheckpoint.epoch,
      }),

      queuedAttestations: new Set(),
      justifiedBalances,
      metrics,
    });
  }
}
