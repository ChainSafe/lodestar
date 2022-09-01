import {ForkName} from "@lodestar/params";
import {allForks, Slot, RootHex, ssz, StringType} from "@lodestar/types";
import {ContainerType} from "@chainsafe/ssz";
import {
  ArrayOf,
  ContainerData,
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
} from "../../utils/index.js";
import {ExecutionOptimistic, StateId} from "./beacon/state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type StateFormat = "json" | "ssz";
export const mimeTypeSSZ = "application/octet-stream";

export type Api = {
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeads(): Promise<{data: {slot: Slot; root: RootHex}[]}>;

  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getDebugChainHeadsV2(): Promise<{data: {slot: Slot; root: RootHex; executionOptimistic: ExecutionOptimistic}[]}>;

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
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: allForks.BeaconState}>;
  getState(stateId: StateId, format: "ssz"): Promise<Uint8Array>;
  getState(
    stateId: StateId,
    format?: StateFormat
  ): Promise<Uint8Array | {executionOptimistic: ExecutionOptimistic; data: allForks.BeaconState}>;

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
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: allForks.BeaconState; version: ForkName}>;
  getStateV2(stateId: StateId, format: "ssz"): Promise<Uint8Array>;
  getStateV2(
    stateId: StateId,
    format?: StateFormat
  ): Promise<Uint8Array | {executionOptimistic: ExecutionOptimistic; data: allForks.BeaconState; version: ForkName}>;
};

export const routesData: RoutesData<Api> = {
  getDebugChainHeads: {url: "/eth/v1/debug/beacon/heads", method: "GET"},
  getDebugChainHeadsV2: {url: "/eth/v2/debug/beacon/heads", method: "GET"},
  getState: {url: "/eth/v1/debug/beacon/states/{state_id}", method: "GET"},
  getStateV2: {url: "/eth/v2/debug/beacon/states/{state_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

export type ReqTypes = {
  getDebugChainHeads: ReqEmpty;
  getDebugChainHeadsV2: ReqEmpty;
  getState: {params: {state_id: string}; headers: {accept?: string}};
  getStateV2: {params: {state_id: string}; headers: {accept?: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const getState: ReqSerializer<Api["getState"], ReqTypes["getState"]> = {
    writeReq: (state_id, format) => ({
      params: {state_id: String(state_id)},
      headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
    }),
    parseReq: ({params, headers}) => [params.state_id, headers.accept === mimeTypeSSZ ? "ssz" : "json"],
    schema: {params: {state_id: Schema.StringRequired}},
  };

  return {
    getDebugChainHeads: reqEmpty,
    getDebugChainHeadsV2: reqEmpty,
    getState: getState,
    getStateV2: getState,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const stringType = new StringType();
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
    getState: ContainerDataExecutionOptimistic(ssz.phase0.BeaconState),
    getStateV2: WithExecutionOptimistic(
      // Teku returns fork as UPPERCASE
      WithVersion((fork: ForkName) => ssz[fork.toLowerCase() as ForkName].BeaconState as TypeJson<allForks.BeaconState>)
    ),
  };
}
