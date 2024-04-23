/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {allForks, ssz, StringType, phase0} from "@lodestar/types";
import {
  ArrayOf,
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  ExecutionOptimisticAndVersionCodec,
  ExecutionOptimisticAndVersionMeta,
  ExecutionOptimisticCodec,
  ExecutionOptimisticMeta,
  WithVersion,
} from "../../utils/codecs.js";
import {Endpoint, RouteDefinitions} from "../../utils/types.js";
import {WireFormat} from "../../utils/headers.js";
import {Schema} from "../../utils/schema.js";
import {StateId} from "./beacon/state.js";

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
    //
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
    //
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
    //
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
   *
   * param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getState: Endpoint<
    //
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    phase0.BeaconState,
    ExecutionOptimisticMeta
  >;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateV2: Endpoint<
    //
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    allForks.BeaconState,
    ExecutionOptimisticAndVersionMeta
  >;
};

export const definitions: RouteDefinitions<Endpoints> = {
  getDebugChainHeads: {
    url: "/eth/v1/debug/beacon/heads",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: SlotRootListType,
      meta: EmptyMetaCodec,
      onlySupport: WireFormat.json,
    },
  },
  getDebugChainHeadsV2: {
    url: "/eth/v2/debug/beacon/heads",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: SlotRootExecutionOptimisticListType,
      meta: EmptyMetaCodec,
      onlySupport: WireFormat.json,
    },
  },
  getProtoArrayNodes: {
    url: "/eth/v0/debug/forkchoice",
    method: "GET",
    req: EmptyGetRequestCodec,
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
      meta: ExecutionOptimisticCodec,
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
      data: WithVersion((fork) => ssz[fork].BeaconState as Type<allForks.BeaconState>),
      meta: ExecutionOptimisticAndVersionCodec,
    },
  },
};
