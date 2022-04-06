import {Epoch, phase0, Slot, ssz, StringType, RootHex, altair, UintNum64} from "@chainsafe/lodestar-types";
import {ContainerType, Type} from "@chainsafe/ssz";
import {RouteDef, TypeJson} from "../utils/index.js";

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
    depth: UintNum64;
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
    [EventType.head]: new ContainerType(
      {
        slot: ssz.Slot,
        block: stringType,
        state: stringType,
        epochTransition: ssz.Boolean,
        previousDutyDependentRoot: stringType,
        currentDutyDependentRoot: stringType,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.block]: new ContainerType(
      {
        slot: ssz.Slot,
        block: stringType,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.attestation]: ssz.phase0.Attestation,
    [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit,

    [EventType.finalizedCheckpoint]: new ContainerType(
      {
        block: stringType,
        state: stringType,
        epoch: ssz.Epoch,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.chainReorg]: new ContainerType(
      {
        slot: ssz.Slot,
        depth: ssz.UintNum64,
        oldHeadBlock: stringType,
        newHeadBlock: stringType,
        oldHeadState: stringType,
        newHeadState: stringType,
        epoch: ssz.Epoch,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.lightclientHeaderUpdate]: new ContainerType(
      {
        syncAggregate: ssz.altair.SyncAggregate,
        attestedHeader: ssz.phase0.BeaconBlockHeader,
      },
      {jsonCase: "eth2"}
    ),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getEventSerdes() {
  const typeByEvent = getTypeByEvent();

  return {
    toJson: (event: BeaconEvent): unknown => {
      const eventType = typeByEvent[event.type] as TypeJson<BeaconEvent["message"]>;
      return eventType.toJson(event.message);
    },
    fromJson: (type: EventType, data: unknown): BeaconEvent["message"] => {
      const eventType = typeByEvent[type] as TypeJson<BeaconEvent["message"]>;
      return eventType.fromJson(data);
    },
  };
}
