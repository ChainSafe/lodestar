/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ssz, StringType, phase0, BeaconState} from "@lodestar/types";
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
  ExecutionOptimisticAndFinalizedCodec,
  ExecutionOptimisticAndFinalizedMeta,
} from "../../utils/metadata.js";
import {Endpoint, RouteDefinitions} from "../../utils/types.js";
import {WireFormat} from "../../utils/wireFormat.js";
import {Schema} from "../../utils/schema.js";
import {StateArgs} from "./beacon/state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

const stringType = new StringType();
const ProtoNodeResponseType = new ContainerType(
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
const SlotRootType = new ContainerType(
  {
    slot: ssz.Slot,
    root: stringType,
  },
  {jsonCase: "eth2"}
);
const SlotRootExecutionOptimisticType = new ContainerType(
  {
    slot: ssz.Slot,
    root: stringType,
    executionOptimistic: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

const ProtoNodeResponseListType = ArrayOf(ProtoNodeResponseType);
const SlotRootListType = ArrayOf(SlotRootType);
const SlotRootExecutionOptimisticListType = ArrayOf(SlotRootExecutionOptimisticType);

type ProtoNodeResponseList = ValueOf<typeof ProtoNodeResponseListType>;
type SlotRootList = ValueOf<typeof SlotRootListType>;
type SlotRootExecutionOptimisticList = ValueOf<typeof SlotRootExecutionOptimisticListType>;

export type Endpoints = {
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeads: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    SlotRootList,
    EmptyMeta
  >;

  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeadsV2: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    SlotRootExecutionOptimisticList,
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
    ProtoNodeResponseList,
    EmptyMeta
  >;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   */
  getState: Endpoint<
    "GET",
    StateArgs,
    {params: {state_id: string}},
    phase0.BeaconState,
    ExecutionOptimisticAndFinalizedMeta
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

// Default timeout is not sufficient to download state as JSON
const GET_STATE_TIMEOUT_MS = 5 * 60 * 1000;

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getDebugChainHeads: {
      url: "/eth/v1/debug/beacon/heads",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: SlotRootListType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
      },
    },
    getDebugChainHeadsV2: {
      url: "/eth/v2/debug/beacon/heads",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: SlotRootExecutionOptimisticListType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
      },
    },
    getProtoArrayNodes: {
      url: "/eth/v0/debug/forkchoice",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ProtoNodeResponseListType,
        meta: EmptyMetaCodec,
        onlySupport: WireFormat.json,
      },
    },
    getState: {
      url: "/eth/v1/debug/beacon/states/{state_id}",
      method: "GET",
      req: {
        writeReq: ({stateId}) => ({params: {state_id: stateId.toString()}}),
        parseReq: ({params}) => ({stateId: params.state_id}),
        schema: {
          params: {state_id: Schema.StringRequired},
        },
      },
      resp: {
        data: ssz.phase0.BeaconState,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
      init: {
        timeoutMs: GET_STATE_TIMEOUT_MS,
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
        timeoutMs: GET_STATE_TIMEOUT_MS,
      },
    },
  };
}
