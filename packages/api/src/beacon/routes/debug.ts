/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ssz, StringType, BeaconState} from "@lodestar/types";
import {
  ArrayOf,
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  WithVersion,
} from "../../utils/codecs.js";
import {
  ExecutionOptimisticFinalizedAndVersionCodec,
  ExecutionOptimisticFinalizedAndVersionMeta,
} from "../../utils/metadata.js";
import {Endpoint, RouteDefinitions} from "../../utils/types.js";
import {WireFormat} from "../../utils/wireFormat.js";
import {Schema} from "../../utils/schema.js";
import {StateArgs} from "./beacon/state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

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

const ProtoNodeListType = ArrayOf(ProtoNodeType);
const DebugChainHeadListType = ArrayOf(DebugChainHeadType);

type ProtoNodeList = ValueOf<typeof ProtoNodeListType>;
type DebugChainHeadList = ValueOf<typeof DebugChainHeadListType>;

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
  };
}
