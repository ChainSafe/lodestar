import {ForkName} from "@lodestar/params";
import {allForks, Slot, RootHex, ssz, StringType} from "@lodestar/types";
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {
  ArrayOf,
  ReturnTypes,
  RoutesData,
  Schema,
  WithVersion,
  TypeJson,
  reqEmpty,
  ReqSerializers,
  ReqEmpty,
  ReqSerializer,
  ContainerDataExecutionOptimistic,
  WithExecutionOptimistic,
  ContainerData,
} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";
import {ExecutionOptimistic, StateId} from "./beacon/state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type StateFormat = "json" | "ssz";
export const mimeTypeSSZ = "application/octet-stream";

const stringType = new StringType();
const protoNodeSszType = new ContainerType(
  {
    executionPayloadBlockHash: stringType,
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

type ProtoNodeApiType = ValueOf<typeof protoNodeSszType>;

export type Api = {
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeads(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: {slot: Slot; root: RootHex}[]}}>>;

  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeadsV2(): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {data: {slot: Slot; root: RootHex; executionOptimistic: ExecutionOptimistic}[]};
    }>
  >;

  /**
   * Dump all ProtoArray's nodes to debug
   */
  getProtoArrayNodes(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: ProtoNodeApiType[]}}>>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getState(
    stateId: StateId,
    format?: "json"
  ): Promise<
    ApiClientResponse<{[HttpStatusCode.OK]: {data: allForks.BeaconState; executionOptimistic: ExecutionOptimistic}}>
  >;
  getState(stateId: StateId, format: "ssz"): Promise<ApiClientResponse<{[HttpStatusCode.OK]: Uint8Array}>>;
  getState(
    stateId: StateId,
    format?: StateFormat
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: Uint8Array | {data: allForks.BeaconState; executionOptimistic: ExecutionOptimistic};
    }>
  >;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateV2(
    stateId: StateId,
    format?: "json"
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {data: allForks.BeaconState; executionOptimistic: ExecutionOptimistic; version: ForkName};
    }>
  >;
  getStateV2(stateId: StateId, format: "ssz"): Promise<ApiClientResponse<{[HttpStatusCode.OK]: Uint8Array}>>;
  getStateV2(
    stateId: StateId,
    format?: StateFormat
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]:
        | Uint8Array
        | {data: allForks.BeaconState; executionOptimistic: ExecutionOptimistic; version: ForkName};
    }>
  >;
};

export const routesData: RoutesData<Api> = {
  getDebugChainHeads: {url: "/eth/v1/debug/beacon/heads", method: "GET"},
  getDebugChainHeadsV2: {url: "/eth/v2/debug/beacon/heads", method: "GET"},
  getProtoArrayNodes: {url: "/eth/v0/debug/forkchoice", method: "GET"},
  getState: {url: "/eth/v1/debug/beacon/states/{state_id}", method: "GET"},
  getStateV2: {url: "/eth/v2/debug/beacon/states/{state_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

export type ReqTypes = {
  getDebugChainHeads: ReqEmpty;
  getDebugChainHeadsV2: ReqEmpty;
  getProtoArrayNodes: ReqEmpty;
  getState: {params: {state_id: string}; headers: {accept?: string}};
  getStateV2: {params: {state_id: string}; headers: {accept?: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const getState: ReqSerializer<Api["getState"], ReqTypes["getState"]> = {
    writeReq: (state_id, format) => ({
      params: {state_id: String(state_id)},
      headers: {accept: format === "ssz" ? mimeTypeSSZ : "application/json"},
    }),
    parseReq: ({params, headers}) => [params.state_id, headers.accept === mimeTypeSSZ ? "ssz" : "json"],
    schema: {params: {state_id: Schema.StringRequired}},
  };

  return {
    getDebugChainHeads: reqEmpty,
    getDebugChainHeadsV2: reqEmpty,
    getProtoArrayNodes: reqEmpty,
    getState: getState,
    getStateV2: getState,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const SlotRoot = new ContainerType(
    {
      slot: ssz.Slot,
      root: stringType,
    },
    {jsonCase: "eth2"}
  );

  const SlotRootExecutionOptimistic = new ContainerType(
    {
      slot: ssz.Slot,
      root: stringType,
      executionOptimistic: ssz.Boolean,
    },
    {jsonCase: "eth2"}
  );

  return {
    getDebugChainHeads: ContainerData(ArrayOf(SlotRoot)),
    getDebugChainHeadsV2: ContainerData(ArrayOf(SlotRootExecutionOptimistic)),
    getProtoArrayNodes: ContainerData(ArrayOf(protoNodeSszType)),
    getState: ContainerDataExecutionOptimistic(ssz.phase0.BeaconState),
    getStateV2: WithExecutionOptimistic(
      // Teku returns fork as UPPERCASE
      WithVersion((fork: ForkName) => ssz[fork.toLowerCase() as ForkName].BeaconState as TypeJson<allForks.BeaconState>)
    ),
  };
}
