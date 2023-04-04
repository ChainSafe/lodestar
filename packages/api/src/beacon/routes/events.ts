import {Epoch, phase0, capella, Slot, ssz, StringType, RootHex, altair, UintNum64, allForks} from "@lodestar/types";
import {ContainerType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {isForkExecution, ForkName} from "@lodestar/params";

import {RouteDef, TypeJson, WithVersion} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

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
  /** The node has received a valid blsToExecutionChange (from P2P or API) */
  blsToExecutionChange = "bls_to_execution_change",
  /** Finalized checkpoint has been updated */
  finalizedCheckpoint = "finalized_checkpoint",
  /** The node has reorganized its chain */
  chainReorg = "chain_reorg",
  /** The node has received a valid sync committee SignedContributionAndProof (from P2P or API) */
  contributionAndProof = "contribution_and_proof",
  /** New or better optimistic header update available */
  lightClientOptimisticUpdate = "light_client_optimistic_update",
  /** New or better finality update available */
  lightClientFinalityUpdate = "light_client_finality_update",
  /** New or better light client update available */
  lightClientUpdate = "light_client_update",
  /** Payload attributes for block proposal */
  payloadAttributes = "payload_attributes",
}

export const eventTypes: {[K in EventType]: K} = {
  [EventType.head]: EventType.head,
  [EventType.block]: EventType.block,
  [EventType.attestation]: EventType.attestation,
  [EventType.voluntaryExit]: EventType.voluntaryExit,
  [EventType.blsToExecutionChange]: EventType.blsToExecutionChange,
  [EventType.finalizedCheckpoint]: EventType.finalizedCheckpoint,
  [EventType.chainReorg]: EventType.chainReorg,
  [EventType.contributionAndProof]: EventType.contributionAndProof,
  [EventType.lightClientOptimisticUpdate]: EventType.lightClientOptimisticUpdate,
  [EventType.lightClientFinalityUpdate]: EventType.lightClientFinalityUpdate,
  [EventType.lightClientUpdate]: EventType.lightClientUpdate,
  [EventType.payloadAttributes]: EventType.payloadAttributes,
};

export type EventData = {
  [EventType.head]: {
    slot: Slot;
    block: RootHex;
    state: RootHex;
    epochTransition: boolean;
    previousDutyDependentRoot: RootHex;
    currentDutyDependentRoot: RootHex;
    executionOptimistic: boolean;
  };
  [EventType.block]: {
    slot: Slot;
    block: RootHex;
    executionOptimistic: boolean;
  };
  [EventType.attestation]: phase0.Attestation;
  [EventType.voluntaryExit]: phase0.SignedVoluntaryExit;
  [EventType.blsToExecutionChange]: capella.SignedBLSToExecutionChange;
  [EventType.finalizedCheckpoint]: {
    block: RootHex;
    state: RootHex;
    epoch: Epoch;
    executionOptimistic: boolean;
  };
  [EventType.chainReorg]: {
    slot: Slot;
    depth: UintNum64;
    oldHeadBlock: RootHex;
    newHeadBlock: RootHex;
    oldHeadState: RootHex;
    newHeadState: RootHex;
    epoch: Epoch;
    executionOptimistic: boolean;
  };
  [EventType.contributionAndProof]: altair.SignedContributionAndProof;
  [EventType.lightClientOptimisticUpdate]: allForks.LightClientOptimisticUpdate;
  [EventType.lightClientFinalityUpdate]: allForks.LightClientFinalityUpdate;
  [EventType.lightClientUpdate]: allForks.LightClientUpdate;
  [EventType.payloadAttributes]: {version: ForkName; data: allForks.SSEPayloadAttributes};
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
  eventstream(
    topics: EventType[],
    signal: AbortSignal,
    onEvent: (event: BeaconEvent) => void
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}>>;
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

export function getTypeByEvent(config: ChainForkConfig): {[K in EventType]: TypeJson<EventData[K]>} {
  const stringType = new StringType();
  const getLightClientTypeFromHeader = (data: allForks.LightClientHeader): allForks.AllForksLightClientSSZTypes => {
    return config.getLightClientForkTypes(data.beacon.slot);
  };

  return {
    [EventType.head]: new ContainerType(
      {
        slot: ssz.Slot,
        block: stringType,
        state: stringType,
        epochTransition: ssz.Boolean,
        previousDutyDependentRoot: stringType,
        currentDutyDependentRoot: stringType,
        executionOptimistic: ssz.Boolean,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.block]: new ContainerType(
      {
        slot: ssz.Slot,
        block: stringType,
        executionOptimistic: ssz.Boolean,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.attestation]: ssz.phase0.Attestation,
    [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit,
    [EventType.blsToExecutionChange]: ssz.capella.SignedBLSToExecutionChange,

    [EventType.finalizedCheckpoint]: new ContainerType(
      {
        block: stringType,
        state: stringType,
        epoch: ssz.Epoch,
        executionOptimistic: ssz.Boolean,
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
        executionOptimistic: ssz.Boolean,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.contributionAndProof]: ssz.altair.SignedContributionAndProof,
    [EventType.payloadAttributes]: WithVersion((fork) =>
      isForkExecution(fork) ? ssz.allForksExecution[fork].SSEPayloadAttributes : ssz.bellatrix.SSEPayloadAttributes
    ),

    [EventType.lightClientOptimisticUpdate]: {
      toJson: (data) =>
        getLightClientTypeFromHeader((data as unknown as allForks.LightClientOptimisticUpdate).attestedHeader)[
          "LightClientOptimisticUpdate"
        ].toJson(data),
      fromJson: (data) =>
        getLightClientTypeFromHeader(
          // eslint-disable-next-line @typescript-eslint/naming-convention
          (data as unknown as {attested_header: allForks.LightClientHeader}).attested_header
        )["LightClientOptimisticUpdate"].fromJson(data),
    },
    [EventType.lightClientFinalityUpdate]: {
      toJson: (data) =>
        getLightClientTypeFromHeader((data as unknown as allForks.LightClientFinalityUpdate).attestedHeader)[
          "LightClientFinalityUpdate"
        ].toJson(data),
      fromJson: (data) =>
        getLightClientTypeFromHeader(
          // eslint-disable-next-line @typescript-eslint/naming-convention
          (data as unknown as {attested_header: allForks.LightClientHeader}).attested_header
        )["LightClientFinalityUpdate"].fromJson(data),
    },
    [EventType.lightClientUpdate]: {
      toJson: (data) =>
        getLightClientTypeFromHeader((data as unknown as allForks.LightClientUpdate).attestedHeader)[
          "LightClientUpdate"
        ].toJson(data),
      fromJson: (data) =>
        getLightClientTypeFromHeader(
          // eslint-disable-next-line @typescript-eslint/naming-convention
          (data as unknown as {attested_header: allForks.LightClientHeader}).attested_header
        )["LightClientUpdate"].fromJson(data),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getEventSerdes(config: ChainForkConfig) {
  const typeByEvent = getTypeByEvent(config);

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
