import {Epoch, Number64, phase0, Slot, ssz, StringType, RootHex, altair} from "@chainsafe/lodestar-types";
import {ContainerType, Json, Type} from "@chainsafe/ssz";
import {jsonOpts, RouteDef, TypeJson} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightclientHeaderUpdate = {
  syncAggregate: altair.SyncAggregate;
  attestedHeader: phase0.BeaconBlockHeader;
};

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
  /** New or better header update available */
  lightclientHeaderUpdate = "lightclient_header_update",
}

export type EventData = {
  [EventType.head]: {
    slot: Slot;
    block: RootHex;
    state: RootHex;
    epochTransition: boolean;
    previousDutyDependentRoot: RootHex;
    currentDutyDependentRoot: RootHex;
  };
  [EventType.block]: {slot: Slot; block: RootHex};
  [EventType.attestation]: phase0.Attestation;
  [EventType.voluntaryExit]: phase0.SignedVoluntaryExit;
  [EventType.finalizedCheckpoint]: {block: RootHex; state: RootHex; epoch: Epoch};
  [EventType.chainReorg]: {
    slot: Slot;
    depth: Number64;
    oldHeadBlock: RootHex;
    newHeadBlock: RootHex;
    oldHeadState: RootHex;
    newHeadState: RootHex;
    epoch: Epoch;
  };
  [EventType.lightclientHeaderUpdate]: LightclientHeaderUpdate;
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

export function getTypeByEvent(): {[K in EventType]: Type<EventData[K]>} {
  const stringType = new StringType();
  return {
    [EventType.head]: new ContainerType<EventData[EventType.head]>({
      fields: {
        slot: ssz.Slot,
        block: stringType,
        state: stringType,
        epochTransition: ssz.Boolean,
        previousDutyDependentRoot: stringType,
        currentDutyDependentRoot: stringType,
      },
      // From beacon apis eventstream
      casingMap: {
        slot: "slot",
        block: "block",
        state: "state",
        epochTransition: "epoch_transition",
        previousDutyDependentRoot: "previous_duty_dependent_root",
        currentDutyDependentRoot: "current_duty_dependent_root",
      },
    }),

    [EventType.block]: new ContainerType<EventData[EventType.block]>({
      fields: {
        slot: ssz.Slot,
        block: stringType,
      },
      // From beacon apis eventstream
      expectedCase: "notransform",
    }),

    [EventType.attestation]: ssz.phase0.Attestation,
    [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit,

    [EventType.finalizedCheckpoint]: new ContainerType<EventData[EventType.finalizedCheckpoint]>({
      fields: {
        block: stringType,
        state: stringType,
        epoch: ssz.Epoch,
      },
      // From beacon apis eventstream
      expectedCase: "notransform",
    }),

    [EventType.chainReorg]: new ContainerType<EventData[EventType.chainReorg]>({
      fields: {
        slot: ssz.Slot,
        depth: ssz.Number64,
        oldHeadBlock: stringType,
        newHeadBlock: stringType,
        oldHeadState: stringType,
        newHeadState: stringType,
        epoch: ssz.Epoch,
      },
      // From beacon apis eventstream
      casingMap: {
        slot: "slot",
        depth: "depth",
        oldHeadBlock: "old_head_block",
        newHeadBlock: "new_head_block",
        oldHeadState: "old_head_state",
        newHeadState: "new_head_state",
        epoch: "epoch",
      },
    }),

    [EventType.lightclientHeaderUpdate]: new ContainerType<EventData[EventType.lightclientHeaderUpdate]>({
      fields: {
        syncAggregate: ssz.altair.SyncAggregate,
        attestedHeader: ssz.phase0.BeaconBlockHeader,
      },
      casingMap: {
        syncAggregate: "sync_aggregate",
        attestedHeader: "attested_header",
      },
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getEventSerdes() {
  const typeByEvent = getTypeByEvent();

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
