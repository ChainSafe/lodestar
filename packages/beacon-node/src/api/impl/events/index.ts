import {computeEpochAtSlot} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {toHexString} from "@chainsafe/ssz";
import {ApiModules, IS_OPTIMISTIC_TEMP} from "../types.js";
import {ChainEvent, IChainEvents} from "../../../chain/index.js";
import {ApiError} from "../errors.js";

/**
 * Mapping of internal `ChainEvents` to API spec events
 */
const chainEventMap = {
  [routes.events.EventType.head]: ChainEvent.head as const,
  [routes.events.EventType.block]: ChainEvent.block as const,
  [routes.events.EventType.attestation]: ChainEvent.attestation as const,
  [routes.events.EventType.voluntaryExit]: ChainEvent.block as const,
  [routes.events.EventType.finalizedCheckpoint]: ChainEvent.finalized as const,
  [routes.events.EventType.chainReorg]: ChainEvent.forkChoiceReorg as const,
  [routes.events.EventType.contributionAndProof]: ChainEvent.contributionAndProof as const,
  [routes.events.EventType.lightClientOptimisticUpdate]: ChainEvent.lightClientOptimisticUpdate as const,
  [routes.events.EventType.lightClientFinalityUpdate]: ChainEvent.lightClientFinalityUpdate as const,
  [routes.events.EventType.lightClientUpdate]: ChainEvent.lightClientUpdate as const,
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
    [routes.events.EventType.head]: (data) => [data],
    [routes.events.EventType.block]: (block) => [
      {
        block: toHexString(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
        slot: block.message.slot,
        executionOptimistic: IS_OPTIMISTIC_TEMP,
      },
    ],
    [routes.events.EventType.attestation]: (attestation) => [attestation],
    [routes.events.EventType.voluntaryExit]: (block) => Array.from(block.message.body.voluntaryExits),
    [routes.events.EventType.finalizedCheckpoint]: (checkpoint, state) => [
      {
        block: toHexString(checkpoint.root),
        epoch: checkpoint.epoch,
        state: toHexString(state.hashTreeRoot()),
        executionOptimistic: IS_OPTIMISTIC_TEMP,
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
        executionOptimistic: IS_OPTIMISTIC_TEMP,
      },
    ],
    [routes.events.EventType.contributionAndProof]: (contributionAndProof) => [contributionAndProof],
    [routes.events.EventType.lightClientOptimisticUpdate]: (headerUpdate) => [headerUpdate],
    [routes.events.EventType.lightClientFinalityUpdate]: (headerUpdate) => [headerUpdate],
    [routes.events.EventType.lightClientUpdate]: (headerUpdate) => [headerUpdate],
  };

  return {
    eventstream(topics, signal, onEvent) {
      const onAbortFns: (() => void)[] = [];

      for (const topic of topics) {
        const eventDataTransformer = eventDataTransformers[topic];
        const chainEvent = chainEventMap[topic];
        if (eventDataTransformer === undefined || !chainEvent) {
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
