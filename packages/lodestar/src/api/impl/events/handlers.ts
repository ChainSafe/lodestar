import {ChainEvent, IChainEvents} from "../../../chain";
import {BeaconEventType, BeaconEvent} from "./types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

type ListenerType<T> = [T] extends [(...args: infer U) => unknown] ? U : [T] extends [void] ? [] : [T];

export type ChainEventListener<E extends keyof IChainEvents> = (...args: ListenerType<IChainEvents[E]>) => void;

export function handleBeaconHeadEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.forkChoiceHead> {
  return (payload) => {
    callback({
      type: BeaconEventType.HEAD,
      message: {
        block: payload.blockRoot,
        epochTransition: computeStartSlotAtEpoch(config, computeEpochAtSlot(config, payload.slot)) === payload.slot,
        slot: payload.slot,
        state: payload.stateRoot,
      },
    });
  };
}

export function handleBeaconBlockEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.block> {
  return (payload) => {
    callback({
      type: BeaconEventType.BLOCK,
      message: {
        block: config.types.phase0.BeaconBlock.hashTreeRoot(payload.message),
        slot: payload.message.slot,
      },
    });
  };
}

export function handleBeaconAttestationEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.attestation> {
  return (payload) => {
    callback({
      type: BeaconEventType.ATTESTATION,
      message: payload,
    });
  };
}

export function handleVoluntaryExitEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.block> {
  return (payload) => {
    for (const exit of payload.message.body.voluntaryExits) {
      callback({
        type: BeaconEventType.VOLUNTARY_EXIT,
        message: exit,
      });
    }
  };
}

export function handleFinalizedCheckpointEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.finalized> {
  return (payload, state) => {
    callback({
      type: BeaconEventType.FINALIZED_CHECKPOINT,
      message: {
        block: payload.root,
        epoch: payload.epoch,
        state: state.hashTreeRoot(),
      },
    });
  };
}

export function handleChainReorgEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<ChainEvent.forkChoiceReorg> {
  return (oldHead, newHead, depth) => {
    callback({
      type: BeaconEventType.CHAIN_REORG,
      message: {
        depth,
        epoch: computeEpochAtSlot(config, newHead.slot),
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: oldHead.blockRoot,
        newHeadState: newHead.stateRoot,
        oldHeadState: oldHead.stateRoot,
      },
    });
  };
}
