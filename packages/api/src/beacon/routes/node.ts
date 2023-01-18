import {allForks, ssz, StringType} from "@lodestar/types";
import {ContainerType} from "@chainsafe/ssz";
import {
  ArrayOf,
  reqEmpty,
  jsonType,
  ReturnTypes,
  RoutesData,
  Schema,
  ReqSerializers,
  ReqEmpty,
  ContainerData,
} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type NetworkIdentity = {
  /** Cryptographic hash of a peer’s public key. [Read more](https://docs.libp2p.io/concepts/peer-id/) */
  peerId: string;
  /** Ethereum node record. [Read more](https://eips.ethereum.org/EIPS/eip-778) */
  enr: string;
  p2pAddresses: string[];
  discoveryAddresses: string[];
  /** Based on Ethereum Consensus [Metadata object](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#metadata) */
  metadata: allForks.Metadata;
};

export type PeerState = "disconnected" | "connecting" | "connected" | "disconnecting";
export type PeerDirection = "inbound" | "outbound";

export type NodePeer = {
  peerId: string;
  enr: string;
  lastSeenP2pAddress: string;
  state: PeerState;
  // the spec does not specify direction for a disconnected peer, lodestar uses null in that case
  direction: PeerDirection | null;
};

export type PeerCount = {
  disconnected: number;
  connecting: number;
  connected: number;
  disconnecting: number;
};

export type FilterGetPeers = {
  state?: PeerState[];
  direction?: PeerDirection[];
};

export type SyncingStatus = {
  /** Head slot node is trying to reach */
  headSlot: string;
  /** How many slots node needs to process to reach head. 0 if synced. */
  syncDistance: string;
  /** Set to true if the node is syncing, false if the node is synced. */
  isSyncing: boolean;
  /** Set to true if the node is optimistically tracking head. */
  isOptimistic: boolean;
};

export enum NodeHealth {
  READY = HttpStatusCode.OK,
  SYNCING = HttpStatusCode.PARTIAL_CONTENT,
  NOT_INITIALIZED_OR_ISSUES = HttpStatusCode.SERVICE_UNAVAILABLE,
}

/**
 * Read information about the beacon node.
 */
export type Api = {
  /**
   * Get node network identity
   * Retrieves data about the node's network presence
   */
  getNetworkIdentity: () => Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: NetworkIdentity}}>>;
  /**
   * Get node network peers
   * Retrieves data about the node's network peers. By default this returns all peers. Multiple query params are combined using AND conditions
   * @param state
   * @param direction
   */
  getPeers(
    filters?: FilterGetPeers
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: NodePeer[]; meta: {count: number}}}>>;
  /**
   * Get peer
   * Retrieves data about the given peer
   * @param peerId
   */
  getPeer(
    peerId: string
  ): Promise<
    ApiClientResponse<{[HttpStatusCode.OK]: {data: NodePeer}}, HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND>
  >;

  /**
   * Get peer count
   * Retrieves number of known peers.
   */
  getPeerCount(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: PeerCount}}>>;

  /**
   * Get version string of the running beacon node.
   * Requests that the beacon node identify information about its implementation in a format similar to a [HTTP User-Agent](https://tools.ietf.org/html/rfc7231#section-5.5.3) field.
   */
  getNodeVersion(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: {version: string}}}>>;

  /**
   * Get node syncing status
   * Requests the beacon node to describe if it's currently syncing or not, and if it is, what block it is up to.
   */
  getSyncingStatus(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: SyncingStatus}}>>;

  /**
   * Get health check
   * Returns node health status in http status codes. Useful for load balancers.
   *
   * NOTE: This route does not return any value
   */
  getHealth(): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: void; [HttpStatusCode.PARTIAL_CONTENT]: void},
      HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;
};

export const routesData: RoutesData<Api> = {
  getNetworkIdentity: {url: "/eth/v1/node/identity", method: "GET"},
  getPeers: {url: "/eth/v1/node/peers", method: "GET"},
  getPeer: {url: "/eth/v1/node/peers/{peer_id}", method: "GET"},
  getPeerCount: {url: "/eth/v1/node/peer_count", method: "GET"},
  getNodeVersion: {url: "/eth/v1/node/version", method: "GET"},
  getSyncingStatus: {url: "/eth/v1/node/syncing", method: "GET"},
  getHealth: {url: "/eth/v1/node/health", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

export type ReqTypes = {
  getNetworkIdentity: ReqEmpty;
  getPeers: {query: {state?: PeerState[]; direction?: PeerDirection[]}};
  getPeer: {params: {peer_id: string}};
  getPeerCount: ReqEmpty;
  getNodeVersion: ReqEmpty;
  getSyncingStatus: ReqEmpty;
  getHealth: ReqEmpty;
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getNetworkIdentity: reqEmpty,

    getPeers: {
      writeReq: (filters) => ({query: filters || {}}),
      parseReq: ({query}) => [query],
      schema: {query: {state: Schema.StringArray, direction: Schema.StringArray}},
    },
    getPeer: {
      writeReq: (peer_id) => ({params: {peer_id}}),
      parseReq: ({params}) => [params.peer_id],
      schema: {params: {peer_id: Schema.StringRequired}},
    },

    getPeerCount: reqEmpty,
    getNodeVersion: reqEmpty,
    getSyncingStatus: reqEmpty,
    getHealth: reqEmpty,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const stringType = new StringType();
  const NetworkIdentity = new ContainerType(
    {
      peerId: stringType,
      enr: stringType,
      p2pAddresses: ArrayOf(stringType),
      discoveryAddresses: ArrayOf(stringType),
      metadata: ssz.altair.Metadata,
    },
    {jsonCase: "eth2"}
  );

  const PeerCount = new ContainerType(
    {
      disconnected: ssz.UintNum64,
      connecting: ssz.UintNum64,
      connected: ssz.UintNum64,
      disconnecting: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  );

  return {
    //
    // TODO: Consider just converting the JSON case without custom types
    //
    getNetworkIdentity: ContainerData(NetworkIdentity),
    // All these types don't contain any BigInt nor Buffer instances.
    // Use jsonType() to translate the casing in a generic way.
    getPeers: jsonType("snake"),
    getPeer: jsonType("snake"),
    getPeerCount: ContainerData(PeerCount),
    getNodeVersion: jsonType("snake"),
    getSyncingStatus: jsonType("snake"),
  };
}
