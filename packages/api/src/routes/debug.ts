import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, Slot, RootHex, ssz, StringType} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";
import {StateId} from "./beacon/state.js";
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
} from "../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

type SlotRoot = {slot: Slot; root: RootHex};
export type StateFormat = "json" | "ssz";
export const mimeTypeSSZ = "application/octet-stream";

export type Api = {
  /**
   * Get fork choice leaves
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getHeads(): Promise<{data: SlotRoot[]}>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getState(stateId: StateId, format?: "json"): Promise<{data: allForks.BeaconState}>;
  getState(stateId: StateId, format: "ssz"): Promise<Uint8Array>;
  getState(stateId: StateId, format?: StateFormat): Promise<Uint8Array | {data: allForks.BeaconState}>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateV2(stateId: StateId, format?: "json"): Promise<{data: allForks.BeaconState; version: ForkName}>;
  getStateV2(stateId: StateId, format: "ssz"): Promise<Uint8Array>;
  getStateV2(
    stateId: StateId,
    format?: StateFormat
  ): Promise<Uint8Array | {data: allForks.BeaconState; version: ForkName}>;

  /**
   * NOT IN SPEC
   * Connect to a peer at the given multiaddr array
   */
  connectToPeer(peerIdStr: string, multiaddr: string[]): Promise<void>;

  /**
   * NOT IN SPEC
   * Disconnect from a peer
   */
  disconnectPeer(peerIdStr: string): Promise<void>;
};

export const routesData: RoutesData<Api> = {
  getHeads: {url: "/eth/v1/debug/beacon/heads", method: "GET"},
  getState: {url: "/eth/v1/debug/beacon/states/:stateId", method: "GET"},
  getStateV2: {url: "/eth/v2/debug/beacon/states/:stateId", method: "GET"},
  connectToPeer: {url: "/eth/v1/debug/connect/:peerId", method: "POST"},
  disconnectPeer: {url: "/eth/v1/debug/disconnect/:peerId", method: "POST"},
};

export type ReqTypes = {
  getHeads: ReqEmpty;
  getState: {params: {stateId: string}; headers: {accept?: string}};
  getStateV2: {params: {stateId: string}; headers: {accept?: string}};
  connectToPeer: {params: {peerId: string}; body: string[]};
  disconnectPeer: {params: {peerId: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const getState: ReqSerializer<Api["getState"], ReqTypes["getState"]> = {
    writeReq: (stateId, format) => ({
      params: {stateId},
      headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
    }),
    parseReq: ({params, headers}) => [params.stateId, headers.accept === mimeTypeSSZ ? "ssz" : "json"],
    schema: {params: {stateId: Schema.StringRequired}},
  };

  return {
    getHeads: reqEmpty,
    getState: getState,
    getStateV2: getState,
    connectToPeer: {
      writeReq: (peerId, multiaddr) => ({params: {peerId}, body: multiaddr}),
      parseReq: ({params, body}) => [params.peerId, body],
      schema: {params: {peerId: Schema.StringRequired}, body: Schema.StringArray},
    },
    disconnectPeer: {
      writeReq: (peerId) => ({params: {peerId}}),
      parseReq: ({params}) => [params.peerId],
      schema: {params: {peerId: Schema.StringRequired}},
    },
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export function getReturnTypes(): ReturnTypes<Api> {
  const stringType = new StringType();
  const SlotRoot = new ContainerType(
    {
      slot: ssz.Slot,
      root: stringType,
    },
    {jsonCase: "eth2"}
  );

  return {
    getHeads: ContainerData(ArrayOf(SlotRoot)),
    getState: ContainerData(ssz.phase0.BeaconState),
    // Teku returns fork as UPPERCASE
    getStateV2: WithVersion(
      (fork: ForkName) => ssz[fork.toLowerCase() as ForkName].BeaconState as TypeJson<allForks.BeaconState>
    ),
  };
}
