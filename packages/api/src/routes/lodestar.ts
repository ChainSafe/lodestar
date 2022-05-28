import {Epoch, RootHex, Slot} from "@chainsafe/lodestar-types";
import {
  jsonType,
  ReqEmpty,
  reqEmpty,
  ReturnTypes,
  ReqSerializers,
  RoutesData,
  sameType,
  Schema,
} from "../utils/index.js";
import {FilterGetPeers, NodePeer, PeerDirection, PeerState} from "./node.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type SyncChainDebugState = {
  targetRoot: string | null;
  targetSlot: number | null;
  syncType: string;
  status: string;
  startEpoch: number;
  peers: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batches: any[];
};

export type GossipQueueItem = {
  topic: unknown;
  propagationSource: string;
  data: Uint8Array;
  addedTimeMs: number;
  seenTimestampSec: number;
};

export type RegenQueueItem = {
  key: string;
  args: unknown;
  addedTimeMs: number;
};

export type BlockProcessorQueueItem = {
  blockSlots: Slot[];
  jobOpts: Record<string, boolean | undefined>;
  addedTimeMs: number;
};

export type StateCacheItem = {
  slot: Slot;
  root: RootHex;
  /** Total number of reads */
  reads: number;
  /** Unix timestamp (ms) of the last read */
  lastRead: number;
};

export type LodestarNodePeer = NodePeer & {
  agentVersion: string;
};

export type Api = {
  /** TODO: description */
  getWtfNode(): Promise<{data: string}>;
  /** Trigger to write a heapdump to disk at `dirpath`. May take > 1min */
  writeHeapdump(dirpath?: string): Promise<{data: {filepath: string}}>;
  /** TODO: description */
  getLatestWeakSubjectivityCheckpointEpoch(): Promise<{data: Epoch}>;
  /** TODO: description */
  getSyncChainsDebugState(): Promise<{data: SyncChainDebugState[]}>;
  /** Dump all items in a gossip queue, by gossipType */
  getGossipQueueItems(gossipType: string): Promise<GossipQueueItem[]>;
  /** Dump all items in the regen queue */
  getRegenQueueItems(): Promise<RegenQueueItem[]>;
  /** Dump all items in the block processor queue */
  getBlockProcessorQueueItems(): Promise<BlockProcessorQueueItem[]>;
  /** Dump a summary of the states in the StateContextCache */
  getStateCacheItems(): Promise<StateCacheItem[]>;
  /** Dump a summary of the states in the CheckpointStateCache */
  getCheckpointStateCacheItems(): Promise<StateCacheItem[]>;
  /** Dump peer gossip stats by peer */
  getGossipPeerScoreStats(): Promise<Record<string, unknown>>;
  /** Run GC with `global.gc()` */
  runGC(): Promise<void>;
  /** Drop all states in the state cache */
  dropStateCache(): Promise<void>;

  /** Connect to peer at this multiaddress */
  connectPeer(peerId: string, multiaddrStrs: string[]): Promise<void>;
  /** Disconnect peer */
  disconnectPeer(peerId: string): Promise<void>;
  /** Same to node api with new fields */
  getPeers(filters?: FilterGetPeers): Promise<{data: LodestarNodePeer[]; meta: {count: number}}>;

  /** Dump Discv5 Kad values */
  discv5GetKadValues(): Promise<{data: string[]}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getWtfNode: {url: "/eth/v1/lodestar/wtfnode", method: "GET"},
  writeHeapdump: {url: "/eth/v1/lodestar/writeheapdump", method: "POST"},
  getLatestWeakSubjectivityCheckpointEpoch: {url: "/eth/v1/lodestar/ws_epoch", method: "GET"},
  getSyncChainsDebugState: {url: "/eth/v1/lodestar/sync-chains-debug-state", method: "GET"},
  getGossipQueueItems: {url: "/eth/v1/lodestar/gossip-queue-items/:gossipType", method: "GET"},
  getRegenQueueItems: {url: "/eth/v1/lodestar/regen-queue-items", method: "GET"},
  getBlockProcessorQueueItems: {url: "/eth/v1/lodestar/block-processor-queue-items", method: "GET"},
  getStateCacheItems: {url: "/eth/v1/lodestar/state-cache-items", method: "GET"},
  getCheckpointStateCacheItems: {url: "/eth/v1/lodestar/checkpoint-state-cache-items", method: "GET"},
  getGossipPeerScoreStats: {url: "/eth/v1/lodestar/gossip-peer-score-stats", method: "GET"},
  runGC: {url: "/eth/v1/lodestar/gc", method: "POST"},
  dropStateCache: {url: "/eth/v1/lodestar/drop-state-cache", method: "POST"},
  connectPeer: {url: "/eth/v1/lodestar/connect_peer", method: "POST"},
  disconnectPeer: {url: "/eth/v1/lodestar/disconnect_peer", method: "POST"},
  getPeers: {url: "/eth/v1/lodestar/peers", method: "GET"},
  discv5GetKadValues: {url: "/eth/v1/debug/discv5-kad-values", method: "GET"},
};

export type ReqTypes = {
  getWtfNode: ReqEmpty;
  writeHeapdump: {query: {dirpath?: string}};
  getLatestWeakSubjectivityCheckpointEpoch: ReqEmpty;
  getSyncChainsDebugState: ReqEmpty;
  getGossipQueueItems: {params: {gossipType: string}};
  getRegenQueueItems: ReqEmpty;
  getBlockProcessorQueueItems: ReqEmpty;
  getStateCacheItems: ReqEmpty;
  getCheckpointStateCacheItems: ReqEmpty;
  getGossipPeerScoreStats: ReqEmpty;
  runGC: ReqEmpty;
  dropStateCache: ReqEmpty;
  connectPeer: {query: {peerId: string; multiaddr: string[]}};
  disconnectPeer: {query: {peerId: string}};
  getPeers: {query: {state?: PeerState[]; direction?: PeerDirection[]}};
  discv5GetKadValues: ReqEmpty;
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getWtfNode: reqEmpty,
    writeHeapdump: {
      writeReq: (dirpath) => ({query: {dirpath}}),
      parseReq: ({query}) => [query.dirpath],
      schema: {query: {dirpath: Schema.String}},
    },
    getLatestWeakSubjectivityCheckpointEpoch: reqEmpty,
    getSyncChainsDebugState: reqEmpty,
    getGossipQueueItems: {
      writeReq: (gossipType) => ({params: {gossipType}}),
      parseReq: ({params}) => [params.gossipType],
      schema: {params: {gossipType: Schema.StringRequired}},
    },
    getRegenQueueItems: reqEmpty,
    getBlockProcessorQueueItems: reqEmpty,
    getStateCacheItems: reqEmpty,
    getCheckpointStateCacheItems: reqEmpty,
    getGossipPeerScoreStats: reqEmpty,
    runGC: reqEmpty,
    dropStateCache: reqEmpty,
    connectPeer: {
      writeReq: (peerId, multiaddr) => ({query: {peerId, multiaddr}}),
      parseReq: ({query}) => [query.peerId, query.multiaddr],
      schema: {query: {peerId: Schema.StringRequired, multiaddr: Schema.StringArray}},
    },
    disconnectPeer: {
      writeReq: (peerId) => ({query: {peerId}}),
      parseReq: ({query}) => [query.peerId],
      schema: {query: {peerId: Schema.StringRequired}},
    },
    getPeers: {
      writeReq: (filters) => ({query: filters || {}}),
      parseReq: ({query}) => [query],
      schema: {query: {state: Schema.StringArray, direction: Schema.StringArray}},
    },
    discv5GetKadValues: reqEmpty,
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getWtfNode: sameType(),
    writeHeapdump: sameType(),
    getLatestWeakSubjectivityCheckpointEpoch: sameType(),
    getSyncChainsDebugState: jsonType("camel"),
    getGossipQueueItems: jsonType("camel"),
    getRegenQueueItems: jsonType("camel"),
    getBlockProcessorQueueItems: jsonType("camel"),
    getStateCacheItems: jsonType("camel"),
    getCheckpointStateCacheItems: jsonType("camel"),
    getGossipPeerScoreStats: jsonType("camel"),
    getPeers: jsonType("camel"),
    discv5GetKadValues: jsonType("camel"),
  };
}
