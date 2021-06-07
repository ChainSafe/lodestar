import {ApiModules} from "../types";
import {ChainEvent, IChainEvents} from "../../../chain";
import {routes} from "@chainsafe/lodestar-api";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {ZERO_HASH} from "../../../constants";
import {ApiError} from "../errors";

/**
 * Mapping of internal `ChainEvents` to API spec events
 */
const chainEventMap = {
  [routes.events.EventType.head]: ChainEvent.forkChoiceHead as const,
  [routes.events.EventType.block]: ChainEvent.block as const,
  [routes.events.EventType.attestation]: ChainEvent.attestation as const,
  [routes.events.EventType.voluntaryExit]: ChainEvent.block as const,
  [routes.events.EventType.finalizedCheckpoint]: ChainEvent.finalized as const,
  [routes.events.EventType.chainReorg]: ChainEvent.forkChoiceReorg as const,
};

export function getEventsApi({chain, config}: Pick<ApiModules, "chain" | "config">): routes.events.Api {
  /**
   * Mapping to convert internal `ChainEvents` payload to the API spec events data
   */
  const eventDataTransformers: {
    [K in routes.events.EventType]: (
      ...args: Parameters<IChainEvents[typeof chainEventMap[K]]>
    ) => routes.events.EventData[K][];
  } = {
    [routes.events.EventType.head]: (head) => [
      {
        block: head.blockRoot,
        epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(head.slot)) === head.slot,
        slot: head.slot,
        state: head.stateRoot,
        // Todo implement
        previousDutyDependentRoot: ZERO_HASH,
        currentDutyDependentRoot: ZERO_HASH,
      },
    ],
    [routes.events.EventType.block]: (block) => [
      {
        block: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
        slot: block.message.slot,
      },
    ],
    [routes.events.EventType.attestation]: (attestation) => [attestation],
    [routes.events.EventType.voluntaryExit]: (block) => Array.from(block.message.body.voluntaryExits),
    [routes.events.EventType.finalizedCheckpoint]: (checkpoint, state) => [
      {
        block: checkpoint.root,
        epoch: checkpoint.epoch,
        state: state.hashTreeRoot(),
      },
    ],
    [routes.events.EventType.chainReorg]: (oldHead, newHead, depth) => [
      {
        depth,
        epoch: computeEpochAtSlot(newHead.slot),
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: oldHead.blockRoot,
        newHeadState: newHead.stateRoot,
        oldHeadState: oldHead.stateRoot,
      },
    ],
  };

  return {
    eventstream(topics, signal, onEvent) {
      const onAbortFns: (() => void)[] = [];

      for (const topic of topics) {
        const eventDataTransformer = eventDataTransformers[topic];
        const chainEvent = chainEventMap[topic];
        if (!eventDataTransformer || !chainEvent) {
          throw new ApiError(400, `Unknown topic ${topic}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (...args: any[]): void => {
          // TODO: What happens if this handler throws? Does it break the other chain.emitter listeners?
          const messages = eventDataTransformer(...args);
          for (const message of messages) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
            onEvent({type: topic, message: message as any});
          }
        };

        chain.emitter.on(chainEvent, handler);
        onAbortFns.push(() => chain.emitter.off(chainEvent, handler));
      }

      signal.addEventListener(
        "abort",
        () => {
          for (const abortFn of onAbortFns) abortFn();
        },
        {once: true}
      );
    },
  };
}
