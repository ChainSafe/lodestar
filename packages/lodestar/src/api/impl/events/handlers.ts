import {IChainEvents} from "../../../chain";
import {BeaconEvent, BeaconEventType} from "./types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export type ChainEventListener<E extends keyof IChainEvents> = (
  payload: Parameters<IChainEvents[E]>[0]
) => void | Promise<void>;

export function handleBeaconHeadEvent(
  config: IBeaconConfig,
  push: (value: BeaconEvent) => void
): ChainEventListener<"forkChoice:head"> {
  return (payload) => {
    push({
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
  push: (value: BeaconEvent) => void
): ChainEventListener<"block"> {
  return (payload) => {
    push({
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
  push: (value: BeaconEvent) => void
): ChainEventListener<"attestation"> {
  return (payload) => {
    push({
      type: BeaconEventType.ATTESTATION,
      message: payload,
    });
  };
}

//TODO: add event
// export function handleVoluntaryExitEvent(
//   config: IBeaconConfig,
//   push: (value: BeaconEvent) => void
// ): ChainEventListener<""> {
//   return (payload) => {
//     push({
//       type: BeaconEventType.VOLUNTARY_EXIT,
//       message: payload,
//     });
//   };
// }

export function handleFinalizedCheckpointEvent(
  config: IBeaconConfig,
  push: (value: BeaconEvent) => void
): ChainEventListener<"forkChoice:finalized"> {
  return (payload) => {
    push({
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
  push: (value: BeaconEvent) => void
): ChainEventListener<"forkChoice:reorg"> {
  return (payload) => {
    push({
      type: BeaconEventType.CHAIN_REORG,
      message: {
        //TODO: add depth to common ancestor
        depth: 0,
        epoch: computeEpochAtSlot(config, payload.slot),
        slot: payload.slot,
        newHeadBlock: payload.blockRoot,
        //TODO: replace with real value
        oldHeadBlock: payload.blockRoot,
        newHeadState: payload.stateRoot,
        //TODO: replace with real value
        oldHeadState: payload.stateRoot,
      },
    });
  };
}
