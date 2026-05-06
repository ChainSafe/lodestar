import {ContainerType, ListBasicType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, MAX_BLOB_COMMITMENTS_PER_BLOCK, isForkPostGloas} from "@lodestar/params";
import {
  Attestation,
  AttesterSlashing,
  BuilderIndex,
  Epoch,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  RootHex,
  SSEPayloadAttributes,
  Slot,
  StringType,
  UintNum64,
  altair,
  capella,
  electra,
  gloas,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {EmptyMeta, EmptyResponseCodec, EmptyResponseData} from "../../utils/codecs.js";
import {getPostAltairForkTypes, getPostBellatrixForkTypes, getPostGloasForkTypes} from "../../utils/fork.js";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {VersionType} from "../../utils/metadata.js";

const stringType = new StringType();
export const blobSidecarSSE = new ContainerType(
  {
    blockRoot: stringType,
    index: ssz.BlobIndex,
    slot: ssz.Slot,
    kzgCommitment: stringType,
    versionedHash: stringType,
  },
  {typeName: "BlobSidecarSSE", jsonCase: "eth2"}
);
type BlobSidecarSSE = ValueOf<typeof blobSidecarSSE>;

export const fuluDataColumnSidecarSSE = new ContainerType(
  {
    blockRoot: stringType,
    index: ssz.ColumnIndex,
    slot: ssz.Slot,
    kzgCommitments: new ListBasicType(stringType, MAX_BLOB_COMMITMENTS_PER_BLOCK),
  },
  {typeName: "DataColumnSidecarSSE", jsonCase: "eth2"}
);
const gloasDataColumnSidecarSSE = new ContainerType(
  {
    blockRoot: stringType,
    index: ssz.ColumnIndex,
    slot: ssz.Slot,
  },
  {typeName: "DataColumnSidecarSSE", jsonCase: "eth2"}
);
type FuluDataColumnSidecarSSE = ValueOf<typeof fuluDataColumnSidecarSSE>;
type GloasDataColumnSidecarSSE = ValueOf<typeof gloasDataColumnSidecarSSE>;
type DataColumnSidecarSSE = FuluDataColumnSidecarSSE | GloasDataColumnSidecarSSE;

export enum EventType {
  /**
   * The node has finished processing, resulting in a new head. previous_duty_dependent_root is
   * `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` and
   * current_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)`.
   * Both dependent roots use the genesis block root in the case of underflow.
   */
  head = "head",
  /** The node has received a block (from P2P or API) that is successfully imported on the fork-choice `on_block` handler */
  block = "block",
  /** The node has received a block (from P2P or API) that passes validation rules of the `beacon_block` topic */
  blockGossip = "block_gossip",
  /** The node has received a valid attestation (from P2P or API) */
  attestation = "attestation",
  /** The node has received a valid SingleAttestation (from P2P or API) */
  singleAttestation = "single_attestation",
  /** The node has received a valid voluntary exit (from P2P or API) */
  voluntaryExit = "voluntary_exit",
  /** The node has received a valid proposer slashing (from P2P or API) */
  proposerSlashing = "proposer_slashing",
  /** The node has received a valid attester slashing (from P2P or API) */
  attesterSlashing = "attester_slashing",
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
  /** Payload attributes for block proposal */
  payloadAttributes = "payload_attributes",
  /** The node has received a valid BlobSidecar (from P2P or API) */
  blobSidecar = "blob_sidecar",
  /** The node has received a valid DataColumnSidecar (from P2P or API) */
  dataColumnSidecar = "data_column_sidecar",
  /** The node has received a `SignedExecutionPayloadEnvelope` (from P2P or API) that is successfully imported on the fork-choice `on_execution_payload` handler */
  executionPayload = "execution_payload",
  /** The node has received a `SignedExecutionPayloadEnvelope` (from P2P or API) that passes validation rules of the `execution_payload` topic */
  executionPayloadGossip = "execution_payload_gossip",
  /** The node has verified that the execution payload and blobs for a block are available and ready for payload attestation */
  executionPayloadAvailable = "execution_payload_available",
  /** The node has received a `SignedExecutionPayloadBid` (from P2P or API) that passes gossip validation on the `execution_payload_bid` topic */
  executionPayloadBid = "execution_payload_bid",
}

export const eventTypes: {[K in EventType]: K} = {
  [EventType.head]: EventType.head,
  [EventType.block]: EventType.block,
  [EventType.blockGossip]: EventType.blockGossip,
  [EventType.attestation]: EventType.attestation,
  [EventType.singleAttestation]: EventType.singleAttestation,
  [EventType.voluntaryExit]: EventType.voluntaryExit,
  [EventType.proposerSlashing]: EventType.proposerSlashing,
  [EventType.attesterSlashing]: EventType.attesterSlashing,
  [EventType.blsToExecutionChange]: EventType.blsToExecutionChange,
  [EventType.finalizedCheckpoint]: EventType.finalizedCheckpoint,
  [EventType.chainReorg]: EventType.chainReorg,
  [EventType.contributionAndProof]: EventType.contributionAndProof,
  [EventType.lightClientOptimisticUpdate]: EventType.lightClientOptimisticUpdate,
  [EventType.lightClientFinalityUpdate]: EventType.lightClientFinalityUpdate,
  [EventType.payloadAttributes]: EventType.payloadAttributes,
  [EventType.blobSidecar]: EventType.blobSidecar,
  [EventType.dataColumnSidecar]: EventType.dataColumnSidecar,
  [EventType.executionPayload]: EventType.executionPayload,
  [EventType.executionPayloadGossip]: EventType.executionPayloadGossip,
  [EventType.executionPayloadAvailable]: EventType.executionPayloadAvailable,
  [EventType.executionPayloadBid]: EventType.executionPayloadBid,
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
  [EventType.blockGossip]: {
    slot: Slot;
    block: RootHex;
  };
  [EventType.attestation]: Attestation;
  [EventType.singleAttestation]: electra.SingleAttestation;
  [EventType.voluntaryExit]: phase0.SignedVoluntaryExit;
  [EventType.proposerSlashing]: phase0.ProposerSlashing;
  [EventType.attesterSlashing]: AttesterSlashing;
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
  [EventType.lightClientOptimisticUpdate]: {version: ForkName; data: LightClientOptimisticUpdate};
  [EventType.lightClientFinalityUpdate]: {version: ForkName; data: LightClientFinalityUpdate};
  [EventType.payloadAttributes]: {version: ForkName; data: SSEPayloadAttributes};
  [EventType.blobSidecar]: BlobSidecarSSE;
  [EventType.dataColumnSidecar]: DataColumnSidecarSSE;
  [EventType.executionPayload]: {
    slot: Slot;
    builderIndex: BuilderIndex;
    blockHash: RootHex;
    blockRoot: RootHex;
    executionOptimistic: boolean;
  };
  [EventType.executionPayloadGossip]: {
    slot: Slot;
    builderIndex: BuilderIndex;
    blockHash: RootHex;
    blockRoot: RootHex;
  };
  [EventType.executionPayloadAvailable]: {
    slot: Slot;
    blockRoot: RootHex;
  };
  [EventType.executionPayloadBid]: {version: ForkName; data: gloas.SignedExecutionPayloadBid};
};

export type BeaconEvent = {[K in EventType]: {type: K; message: EventData[K]}}[EventType];

type EventstreamArgs = {
  /** Event types to subscribe to */
  topics: EventType[];
  signal: AbortSignal;
  onEvent: (event: BeaconEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
};

export type Endpoints = {
  /**
   * Subscribe to beacon node events
   * Provides endpoint to subscribe to beacon node Server-Sent-Events stream.
   * Consumers should use [eventsource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)
   * implementation to listen on those events.
   *
   * Returns if SSE stream has been opened.
   */
  eventstream: Endpoint<
    // ⏎
    "GET",
    EventstreamArgs,
    {query: {topics: EventType[]}},
    EmptyResponseData,
    EmptyMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    eventstream: {
      url: "/eth/v1/events",
      method: "GET",
      req: {
        writeReq: ({topics}) => ({query: {topics}}),
        parseReq: ({query}) => ({topics: query.topics}) as EventstreamArgs,
        schema: {
          query: {topics: Schema.StringArrayRequired},
        },
      },
      resp: EmptyResponseCodec,
    },
  };
}

export type TypeJson<T> = {
  toJson: (data: T) => unknown; // server
  fromJson: (data: unknown) => T; // client
};

export function getTypeByEvent(config: ChainForkConfig): {[K in EventType]: TypeJson<EventData[K]>} {
  const WithVersion = <T>(getType: (fork: ForkName) => TypeJson<T>): TypeJson<{data: T; version: ForkName}> => {
    return {
      toJson: ({data, version}) => ({
        data: getType(version).toJson(data),
        version,
      }),
      fromJson: (val) => {
        const {version} = VersionType.fromJson(val);
        return {
          data: getType(version).fromJson((val as {data: unknown}).data),
          version,
        };
      },
    };
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
    [EventType.blockGossip]: new ContainerType(
      {
        slot: ssz.Slot,
        block: stringType,
      },
      {jsonCase: "eth2"}
    ),

    [EventType.attestation]: {
      toJson: (attestation) => {
        const fork = config.getForkName(attestation.data.slot);
        return sszTypesFor(fork).Attestation.toJson(attestation);
      },
      fromJson: (attestation) => {
        const fork = config.getForkName((attestation as Attestation).data.slot);
        return sszTypesFor(fork).Attestation.fromJson(attestation);
      },
    },
    [EventType.singleAttestation]: ssz.electra.SingleAttestation,
    [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit,
    [EventType.proposerSlashing]: ssz.phase0.ProposerSlashing,
    [EventType.attesterSlashing]: {
      toJson: (attesterSlashing) => {
        const fork = config.getForkName(Number(attesterSlashing.attestation1.data.slot));
        return sszTypesFor(fork).AttesterSlashing.toJson(attesterSlashing);
      },
      fromJson: (attesterSlashing) => {
        const fork = config.getForkName(Number((attesterSlashing as AttesterSlashing).attestation1.data.slot));
        return sszTypesFor(fork).AttesterSlashing.fromJson(attesterSlashing);
      },
    },
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
    [EventType.payloadAttributes]: WithVersion((fork) => getPostBellatrixForkTypes(fork).SSEPayloadAttributes),
    [EventType.blobSidecar]: blobSidecarSSE,
    [EventType.dataColumnSidecar]: {
      toJson: (data) => {
        const fork = config.getForkName(data.slot);
        if (isForkPostGloas(fork)) {
          return gloasDataColumnSidecarSSE.toJson(data);
        }
        return fuluDataColumnSidecarSSE.toJson(data as FuluDataColumnSidecarSSE);
      },
      fromJson: (data) => {
        const fork = config.getForkName(Number((data as DataColumnSidecarSSE).slot));
        if (isForkPostGloas(fork)) {
          return gloasDataColumnSidecarSSE.fromJson(data);
        }
        return fuluDataColumnSidecarSSE.fromJson(data);
      },
    },
    [EventType.executionPayload]: new ContainerType(
      {
        slot: ssz.Slot,
        builderIndex: ssz.BuilderIndex,
        blockHash: stringType,
        blockRoot: stringType,
        executionOptimistic: ssz.Boolean,
      },
      {jsonCase: "eth2"}
    ),
    [EventType.executionPayloadGossip]: new ContainerType(
      {
        slot: ssz.Slot,
        builderIndex: ssz.BuilderIndex,
        blockHash: stringType,
        blockRoot: stringType,
      },
      {jsonCase: "eth2"}
    ),
    [EventType.executionPayloadAvailable]: new ContainerType(
      {
        slot: ssz.Slot,
        blockRoot: stringType,
      },
      {jsonCase: "eth2"}
    ),
    [EventType.executionPayloadBid]: WithVersion((fork) => getPostGloasForkTypes(fork).SignedExecutionPayloadBid),

    [EventType.lightClientOptimisticUpdate]: WithVersion(
      (fork) => getPostAltairForkTypes(fork).LightClientOptimisticUpdate
    ),
    [EventType.lightClientFinalityUpdate]: WithVersion(
      (fork) => getPostAltairForkTypes(fork).LightClientFinalityUpdate
    ),
  };
}

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
