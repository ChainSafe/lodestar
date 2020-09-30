import {IChainEvents} from "../../../chain";
import {BeaconEventType, BeaconEvent} from "./types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

type ListenerType<T> = [T] extends [(...args: infer U) => unknown] ? U : [T] extends [void] ? [] : [T];

export type ChainEventListener<E extends keyof IChainEvents> = (...args: ListenerType<IChainEvents[E]>) => void;

export function handleBeaconHeadEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<"forkChoice:head"> {
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
): ChainEventListener<"block"> {
  return (payload) => {
    callback({
      type: BeaconEventType.BLOCK,
      message: {
        block: config.types.BeaconBlock.hashTreeRoot(payload.message),
        slot: payload.message.slot,
      },
    });
  };
}

export function handleBeaconAttestationEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<"attestation"> {
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
): ChainEventListener<"voluntaryExit"> {
  return (payload) => {
    callback({
      type: BeaconEventType.VOLUNTARY_EXIT,
      message: payload,
    });
  };
}

export function handleFinalizedCheckpointEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<"finalized"> {
  return (payload) => {
    callback({
      type: BeaconEventType.FINALIZED_CHECKPOINT,
      message: {
        block: payload.root,
        epoch: payload.epoch,
        //TODO: add state root to finalized checkpoint event
        state: Buffer.alloc(32, 0),
      },
    });
  };
}

export function handleChainReorgEvent(
  config: IBeaconConfig,
  callback: (value: BeaconEvent) => void
): ChainEventListener<"forkChoice:reorg"> {
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
