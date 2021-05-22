import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";
import {
  ArrayOf,
  ContainerData,
  reqEmpty,
  jsonType,
  ReturnTypes,
  RouteReqTypeGenerator,
  RoutesData,
  Schema,
  StringType,
} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

export type NetworkIdentity = {
  /** Cryptographic hash of a peer’s public key. [Read more](https://docs.libp2p.io/concepts/peer-id/) */
  peerId: string;
  /** Ethereum node record. [Read more](https://eips.ethereum.org/EIPS/eip-778) */
  enr: string;
  p2pAddresses: string[];
  discoveryAddresses: string[];
  /** Based on eth2 [Metadata object](https://github.com/ethereum/eth2.0-specs/blob/v1.0.1/specs/phase0/p2p-interface.md#metadata) */
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
  headSlot: Slot;
  /** How many slots node needs to process to reach head. 0 if synced. */
  syncDistance: Slot;
};

/**
 * Read information about the beacon node.
 */
export type Api = {
  /**
   * Get node network identity
   * Retrieves data about the node's network presence
   */
  getNetworkIdentity(): Promise<{data: NetworkIdentity}>;

  /**
   * Get node network peers
   * Retrieves data about the node's network peers. By default this returns all peers. Multiple query params are combined using AND conditions
   * @param state
   * @param direction
   */
  getPeers(filters?: FilterGetPeers): Promise<{data: NodePeer[]; meta: {count: number}}>;

  /**
   * Get peer
   * Retrieves data about the given peer
   * @param peerId
   */
  getPeer(peerId: string): Promise<{data: NodePeer}>;

  /**
   * Get peer count
   * Retrieves number of known peers.
   */
  getPeerCount(): Promise<{data: PeerCount}>;

  /**
   * Get version string of the running beacon node.
   * Requests that the beacon node identify information about its implementation in a format similar to a [HTTP User-Agent](https://tools.ietf.org/html/rfc7231#section-5.5.3) field.
   */
  getNodeVersion(): Promise<{data: {version: string}}>;

  /**
   * Get node syncing status
   * Requests the beacon node to describe if it's currently syncing or not, and if it is, what block it is up to.
   */
  getSyncingStatus(): Promise<{data: SyncingStatus}>;

  /**
   * Get health check
   * Returns node health status in http status codes. Useful for load balancers.
   */
  getHealth(): Promise<void>;
};

export const routesData: RoutesData<Api> = {
  getNetworkIdentity: {url: "/eth/v1/node/identity", method: "GET"},
  getPeers: {url: "/eth/v1/node/peers", method: "GET"},
  getPeer: {url: "/eth/v1/node/peers/:peerId", method: "GET"},
  getPeerCount: {url: "/eth/v1/node/peer_count", method: "GET"},
  getNodeVersion: {url: "/eth/v1/node/version", method: "GET"},
  getSyncingStatus: {url: "/eth/v1/node/syncing", method: "GET"},
  getHealth: {url: "/eth/v1/node/health", method: "GET"},
};

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerdes>]: ReturnType<ReturnType<typeof getReqSerdes>[K]["writeReq"]>;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerdes() {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  return {
    getNetworkIdentity: reqEmpty,

    getPeers: t.getPeers<{query: {state?: PeerState[]; direction?: PeerDirection[]}}>({
      writeReq: (filters) => ({query: filters || {}}),
      parseReq: ({query}) => [query],
      schema: {query: {state: Schema.StringArray, direction: Schema.StringArray}},
    }),
    getPeer: t.getPeer<{params: {peerId: string}}>({
      writeReq: (peerId) => ({params: {peerId}}),
      parseReq: ({params}) => [params.peerId],
      schema: {params: {peerId: Schema.StringRequired}},
    }),

    getPeerCount: reqEmpty,
    getNodeVersion: reqEmpty,
    getSyncingStatus: reqEmpty,
    getHealth: reqEmpty,
  };
}

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  const stringType = new StringType();
  const NetworkIdentity = new ContainerType<NetworkIdentity>({
    fields: {
      peerId: stringType,
      enr: stringType,
      p2pAddresses: ArrayOf(stringType),
      discoveryAddresses: ArrayOf(stringType),
      metadata: config.types.altair.Metadata,
    },
  });

  return {
    //
    // TODO: Consider just converting the JSON case without custom types
    //
    getNetworkIdentity: ContainerData(NetworkIdentity),
    // All these types don't contain any BigInt nor Buffer instances.
    // Use jsonType() to translate the casing in a generic way.
    getPeers: jsonType(),
    getPeer: jsonType(),
    getPeerCount: jsonType(),
    getNodeVersion: jsonType(),
    getSyncingStatus: jsonType(),
  };
}
