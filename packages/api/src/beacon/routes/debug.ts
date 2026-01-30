import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ArrayOf, BeaconState, StringType, fulu, ssz} from "@lodestar/types";
import {
  EmptyArgs,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyRequestCodec,
  WithVersion,
} from "../../utils/codecs.js";
import {
  ExecutionOptimisticFinalizedAndVersionCodec,
  ExecutionOptimisticFinalizedAndVersionMeta,
} from "../../utils/metadata.js";
import {Schema} from "../../utils/schema.js";
import {Endpoint, RouteDefinitions} from "../../utils/types.js";
import {WireFormat} from "../../utils/wireFormat.js";
import {BlockArgs} from "./beacon/block.js";
import {StateArgs} from "./beacon/state.js";

const stringType = new StringType();
const ProtoNodeType = new ContainerType(
  {
    executionPayloadBlockHash: stringType,
    executionPayloadNumber: ssz.UintNum64,
    executionStatus: stringType,
    slot: ssz.Slot,
    blockRoot: stringType,
    parentRoot: stringType,
    stateRoot: stringType,
    targetRoot: stringType,
    timeliness: ssz.Boolean,
    justifiedEpoch: ssz.Epoch,
    justifiedRoot: stringType,
    finalizedEpoch: ssz.Epoch,
    finalizedRoot: stringType,
    unrealizedJustifiedEpoch: ssz.Epoch,
    unrealizedJustifiedRoot: stringType,
    unrealizedFinalizedEpoch: ssz.Epoch,
    unrealizedFinalizedRoot: stringType,
    parent: stringType,
    weight: ssz.Uint32,
    bestChild: stringType,
    bestDescendant: stringType,
  },
  {jsonCase: "eth2"}
);
const DebugChainHeadType = new ContainerType(
  {
    slot: ssz.Slot,
    root: stringType,
    executionOptimistic: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

const ForkChoiceNodeType = new ContainerType(
  {
    slot: ssz.Slot,
    blockRoot: stringType,
    parentRoot: stringType,
    justifiedEpoch: ssz.Epoch,
    finalizedEpoch: ssz.Epoch,
    weight: ssz.UintNum64,
    validity: new StringType<"valid" | "invalid" | "optimistic">(),
    executionBlockHash: stringType,
  },
  {jsonCase: "eth2"}
);
const ForkChoiceResponseType = new ContainerType(
  {
    justifiedCheckpoint: ssz.phase0.Checkpoint,
    finalizedCheckpoint: ssz.phase0.Checkpoint,
    forkChoiceNodes: ArrayOf(ForkChoiceNodeType),
  },
  {jsonCase: "eth2"}
);

const ProtoNodeListType = ArrayOf(ProtoNodeType);
const DebugChainHeadListType = ArrayOf(DebugChainHeadType);

type ProtoNodeList = ValueOf<typeof ProtoNodeListType>;
type DebugChainHeadList = ValueOf<typeof DebugChainHeadListType>;
type ForkChoiceResponse = ValueOf<typeof ForkChoiceResponseType>;

export type Endpoints = {
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeadsV2: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    DebugChainHeadList,
    EmptyMeta
  >;

  /**
   * Retrieves all current fork choice context
   */
  getDebugForkChoice: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    ForkChoiceResponse,
    EmptyMeta
  >;

  /**
   * Dump all ProtoArray's nodes to debug
   */
  getProtoArrayNodes: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    ProtoNodeList,
    EmptyMeta
  >;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   */
  getStateV2: Endpoint<
    "GET",
    StateArgs,
    {params: {state_id: string}},
    BeaconState,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;

  /**
   * Get data column sidecars
   * Retrieves data column sidecars for a given block id.
   */
  getDebugDataColumnSidecars: Endpoint<
    "GET",
    BlockArgs & {
      /**
       * Array of indices for data column sidecars to request for in the specified block.
       * This endpoint will only return columns that the node is actually custodying.
       * If not specified, returns all data column sidecars that this node is custodying in the block.
       */
      indices?: number[];
    },
    {params: {block_id: string}; query: {indices?: number[]}},
    fulu.DataColumnSidecars,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getDebugChainHeadsV2: {
      url: "/eth/v2/debug/beacon/heads",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: DebugChainHeadListType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
      },
    },
    getDebugForkChoice: {
      url: "/eth/v1/debug/fork_choice",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ForkChoiceResponseType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
        transform: {
          toResponse: (data) => ({
            ...(data as ForkChoiceResponse),
          }),
          fromResponse: (resp) => ({
            data: resp as ForkChoiceResponse,
          }),
        },
      },
    },
    getProtoArrayNodes: {
      url: "/eth/v0/debug/forkchoice",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ProtoNodeListType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
      },
    },
    getStateV2: {
      url: "/eth/v2/debug/beacon/states/{state_id}",
      method: "GET",
      req: {
        writeReq: ({stateId}) => ({params: {state_id: stateId.toString()}}),
        parseReq: ({params}) => ({stateId: params.state_id}),
        schema: {
          params: {state_id: Schema.StringRequired},
        },
      },
      resp: {
        data: WithVersion((fork) => ssz[fork].BeaconState as Type<BeaconState>),
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
      init: {
        // Default timeout is not sufficient to download state as JSON
        timeoutMs: 5 * 60 * 1000,
      },
    },
    getDebugDataColumnSidecars: {
      url: "/eth/v1/debug/beacon/data_column_sidecars/{block_id}",
      method: "GET",
      req: {
        writeReq: ({blockId, indices}) => ({params: {block_id: blockId.toString()}, query: {indices}}),
        parseReq: ({params, query}) => ({blockId: params.block_id, indices: query.indices}),
        schema: {params: {block_id: Schema.StringRequired}, query: {indices: Schema.UintArray}},
      },
      resp: {
        data: ssz.fulu.DataColumnSidecars,
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
    },
  };
}
