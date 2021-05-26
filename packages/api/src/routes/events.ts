import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Number64, phase0, Slot, Root} from "@chainsafe/lodestar-types";
import {ContainerType, Json, Type} from "@chainsafe/ssz";
import {jsonOpts, RouteDef, TypeJson} from "../utils";

export enum EventType {
  /**
   * The node has finished processing, resulting in a new head. previous_duty_dependent_root is
   * `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` and
   * current_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)`.
   * Both dependent roots use the genesis block root in the case of underflow.
   */
  head = "head",
  /** The node has received a valid block (from P2P or API) */
  block = "block",
  /** The node has received a valid attestation (from P2P or API) */
  attestation = "attestation",
  /** The node has received a valid voluntary exit (from P2P or API) */
  voluntaryExit = "voluntary_exit",
  /** Finalized checkpoint has been updated */
  finalizedCheckpoint = "finalized_checkpoint",
  /** The node has reorganized its chain */
  chainReorg = "chain_reorg",
}

export type EventData = {
  [EventType.head]: {
    slot: Slot;
    block: Root;
    state: Root;
    epochTransition: boolean;
    previousDutyDependentRoot: Root;
    currentDutyDependentRoot: Root;
  };
  [EventType.block]: {slot: Slot; block: Root};
  [EventType.attestation]: phase0.Attestation;
  [EventType.voluntaryExit]: phase0.SignedVoluntaryExit;
  [EventType.finalizedCheckpoint]: {block: Root; state: Root; epoch: Epoch};
  [EventType.chainReorg]: {
    slot: Slot;
    depth: Number64;
    oldHeadBlock: Root;
    newHeadBlock: Root;
    oldHeadState: Root;
    newHeadState: Root;
    epoch: Epoch;
  };
};

export type BeaconEvent = {[K in EventType]: {type: K; message: EventData[K]}}[EventType];

export type Api = {
  /**
   * Subscribe to beacon node events
   * Provides endpoint to subscribe to beacon node Server-Sent-Events stream.
   * Consumers should use [eventsource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)
   * implementation to listen on those events.
   *
   * @param topics Event types to subscribe to
   * @returns Opened SSE stream.
   */
  eventstream(topics: EventType[], signal: AbortSignal, onEvent: (event: BeaconEvent) => void): void;
};

export const routesData: {[K in keyof Api]: RouteDef} = {
  eventstream: {url: "/eth/v1/events", method: "GET"},
};

export type ReqTypes = {
  eventstream: {
    query: {topics: EventType[]};
  };
};

// It doesn't make sense to define a getReqSerializers() here given the exotic argument of eventstream()
// The request is very simple: (topics) => {query: {topics}}, and the test will ensure compatibility server - client

export function getTypeByEvent(config: IBeaconConfig): {[K in EventType]: Type<EventData[K]>} {
  return {
    [EventType.head]: new ContainerType<EventData[EventType.head]>({
      fields: {
        slot: config.types.Slot,
        block: config.types.Root,
        state: config.types.Root,
        epochTransition: config.types.Boolean,
        previousDutyDependentRoot: config.types.Root,
        currentDutyDependentRoot: config.types.Root,
      },
    }),

    [EventType.block]: new ContainerType<EventData[EventType.block]>({
      fields: {
        slot: config.types.Slot,
        block: config.types.Root,
      },
    }),

    [EventType.attestation]: config.types.phase0.Attestation,
    [EventType.voluntaryExit]: config.types.phase0.SignedVoluntaryExit,

    [EventType.finalizedCheckpoint]: new ContainerType<EventData[EventType.finalizedCheckpoint]>({
      fields: {
        block: config.types.Root,
        state: config.types.Root,
        epoch: config.types.Epoch,
      },
    }),

    [EventType.chainReorg]: new ContainerType<EventData[EventType.chainReorg]>({
      fields: {
        slot: config.types.Slot,
        depth: config.types.Number64,
        oldHeadBlock: config.types.Root,
        newHeadBlock: config.types.Root,
        oldHeadState: config.types.Root,
        newHeadState: config.types.Root,
        epoch: config.types.Epoch,
      },
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getEventSerdes(config: IBeaconConfig) {
  const typeByEvent = getTypeByEvent(config);

  return {
    toJson: (event: BeaconEvent): Json => {
      const eventType = typeByEvent[event.type] as TypeJson<BeaconEvent["message"]>;
      return eventType.toJson(event.message, jsonOpts);
    },
    fromJson: (type: EventType, data: Json): BeaconEvent["message"] => {
      const eventType = typeByEvent[type] as TypeJson<BeaconEvent["message"]>;
      return eventType.fromJson(data, jsonOpts);
    },
  };
}
