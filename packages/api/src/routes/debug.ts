import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, Slot, Root, ssz} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";
import {StateId} from "./beacon/state";
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
} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

type SlotRoot = {slot: Slot; root: Root};

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
  getState(stateId: StateId): Promise<{data: allForks.BeaconState}>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateV2(stateId: StateId): Promise<{data: allForks.BeaconState; version: ForkName}>;

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
  getState: {params: {stateId: string}};
  getStateV2: {params: {stateId: string}};
  connectToPeer: {params: {peerId: string}; body: string[]};
  disconnectPeer: {params: {peerId: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const getState: ReqSerializer<Api["getState"], ReqTypes["getState"]> = {
    writeReq: (stateId) => ({params: {stateId}}),
    parseReq: ({params}) => [params.stateId],
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
  const SlotRoot = new ContainerType<SlotRoot>({
    fields: {
      slot: ssz.Slot,
      root: ssz.Root,
    },
  });

  return {
    getHeads: ContainerData(ArrayOf(SlotRoot)),
    getState: ContainerData(ssz.phase0.BeaconState),
    getStateV2: WithVersion((fork: ForkName) => ssz[fork].BeaconState as TypeJson<allForks.BeaconState>),
  };
}
