import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ssz, stringType} from "@lodestar/types";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyResponseCodec,
} from "../../utils/codecs.js";
import {HttpStatusCode} from "../../utils/httpStatusCode.js";
import {WireFormat} from "../../utils/wireFormat.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export const NetworkIdentityType = new ContainerType(
  {
    /** Cryptographic hash of a peer’s public key. [Read more](https://docs.libp2p.io/concepts/peer-id/) */
    peerId: stringType,
    /** Ethereum node record. [Read more](https://eips.ethereum.org/EIPS/eip-778) */
    enr: stringType,
    p2pAddresses: ArrayOf(stringType),
    discoveryAddresses: ArrayOf(stringType),
    /** Based on Ethereum Consensus [Metadata object](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#metadata) */
    metadata: ssz.altair.Metadata,
  },
  {jsonCase: "eth2"}
);

export const PeerCountType = new ContainerType(
  {
    disconnected: ssz.UintNum64,
    connecting: ssz.UintNum64,
    connected: ssz.UintNum64,
    disconnecting: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);

export const SyncingStatusType = new ContainerType(
  {
    /** Head slot node is trying to reach */
    headSlot: ssz.Slot,
    /** How many slots node needs to process to reach head. 0 if synced. */
    syncDistance: ssz.Slot,
    /** Set to true if the node is syncing, false if the node is synced. */
    isSyncing: ssz.Boolean,
    /** Set to true if the node is optimistically tracking head. */
    isOptimistic: ssz.Boolean,
    /** Set to true if the connected el client is offline */
    elOffline: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

export type NetworkIdentity = ValueOf<typeof NetworkIdentityType>;

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

export type PeersMeta = {count: number};

export type PeerCount = ValueOf<typeof PeerCountType>;

export type FilterGetPeers = {
  state?: PeerState[];
  direction?: PeerDirection[];
};

export type SyncingStatus = ValueOf<typeof SyncingStatusType>;

export enum NodeHealth {
  READY = HttpStatusCode.OK,
  SYNCING = HttpStatusCode.PARTIAL_CONTENT,
  NOT_INITIALIZED_OR_ISSUES = HttpStatusCode.SERVICE_UNAVAILABLE,
}

/**
 * Read information about the beacon node.
 */
export type Endpoints = {
  /**
   * Get node network identity
   * Retrieves data about the node's network presence
   */
  getNetworkIdentity: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    NetworkIdentity,
    EmptyMeta
  >;

  /**
   * Get node network peers
   * Retrieves data about the node's network peers. By default this returns all peers. Multiple query params are combined using AND conditions
   */
  getPeers: Endpoint<
    "GET",
    FilterGetPeers,
    {query: {state?: PeerState[]; direction?: PeerDirection[]}},
    NodePeer[],
    PeersMeta
  >;

  /**
   * Get peer
   * Retrieves data about the given peer
   */
  getPeer: Endpoint<
    // ⏎
    "GET",
    {peerId: string},
    {params: {peer_id: string}},
    NodePeer,
    EmptyMeta
  >;

  /**
   * Get peer count
   * Retrieves number of known peers.
   */
  getPeerCount: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    PeerCount,
    EmptyMeta
  >;

  /**
   * Get version string of the running beacon node.
   * Requests that the beacon node identify information about its implementation in a format similar to a [HTTP User-Agent](https://tools.ietf.org/html/rfc7231#section-5.5.3) field.
   */
  getNodeVersion: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    {version: string},
    EmptyMeta
  >;

  /**
   * Get node syncing status
   * Requests the beacon node to describe if it's currently syncing or not, and if it is, what block it is up to.
   */
  getSyncingStatus: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    SyncingStatus,
    EmptyMeta
  >;

  /**
   * Get health check
   * Returns node health status in http status codes. Useful for load balancers.
   */
  getHealth: Endpoint<
    // ⏎
    "GET",
    {syncingStatus?: number},
    {query: {syncing_status?: number}},
    EmptyResponseData,
    EmptyMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getNetworkIdentity: {
      url: "/eth/v1/node/identity",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        onlySupport: WireFormat.json,
        data: NetworkIdentityType,
        meta: EmptyMetaCodec,
      },
    },
    getPeers: {
      url: "/eth/v1/node/peers",
      method: "GET",
      req: {
        writeReq: ({state, direction}) => ({query: {state, direction}}),
        parseReq: ({query}) => ({state: query.state, direction: query.direction}),
        schema: {query: {state: Schema.StringArray, direction: Schema.StringArray}},
      },
      resp: {
        ...JsonOnlyResponseCodec,
        meta: {
          toJson: (d) => d,
          fromJson: (d) => ({count: (d as PeersMeta).count}),
          toHeadersObject: () => ({}),
          fromHeaders: () => ({}) as PeersMeta,
        },
        transform: {
          toResponse: (data, meta) => ({data, meta}),
          fromResponse: (resp) => resp as {data: NodePeer[]; meta: PeersMeta},
        },
      },
    },
    getPeer: {
      url: "/eth/v1/node/peers/{peer_id}",
      method: "GET",
      req: {
        writeReq: ({peerId}) => ({params: {peer_id: peerId}}),
        parseReq: ({params}) => ({peerId: params.peer_id}),
        schema: {params: {peer_id: Schema.StringRequired}},
      },
      resp: JsonOnlyResponseCodec,
    },
    getPeerCount: {
      url: "/eth/v1/node/peer_count",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: PeerCountType,
        meta: EmptyMetaCodec,
      },
    },
    getNodeVersion: {
      url: "/eth/v1/node/version",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getSyncingStatus: {
      url: "/eth/v1/node/syncing",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: SyncingStatusType,
        meta: EmptyMetaCodec,
      },
    },
    getHealth: {
      url: "/eth/v1/node/health",
      method: "GET",
      req: {
        writeReq: ({syncingStatus}) => ({query: {syncing_status: syncingStatus}}),
        parseReq: ({query}) => ({syncingStatus: query.syncing_status}),
        schema: {query: {syncing_status: Schema.Uint}},
      },
      resp: EmptyResponseCodec,
    },
  };
}
