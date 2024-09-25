import {ChainForkConfig} from "@lodestar/config";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {Schema, Endpoint, RouteDefinitions} from "../../utils/index.js";
import {
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyResponseCodec,
} from "../../utils/codecs.js";
import {FilterGetPeers, NodePeer, PeerDirection, PeerState} from "./node.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type SyncChainDebugState = {
  targetRoot: string | null;
  targetSlot: number | null;
  syncType: string;
  status: string;
  startEpoch: number;
  peers: number;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  batches: any[];
};

export type GossipQueueItem = {
  topic: unknown;
  propagationSource: string;
  data: Uint8Array;
  addedTimeMs: number;
  seenTimestampSec: number;
};

export type PeerScoreStat = {
  peerId: string;
  lodestarScore: number;
  gossipScore: number;
  ignoreNegativeGossipScore: boolean;
  score: number;
  lastUpdate: number;
};

export type GossipPeerScoreStat = {
  peerId: string;
  // + Other un-typed options
};

export type RegenQueueItem = {
  key: string;
  args: unknown;
  addedTimeMs: number;
};

export type BlockProcessorQueueItem = {
  blockSlots: Slot[];
  jobOpts: Record<string, string | number | boolean | undefined>;
  addedTimeMs: number;
};

export type StateCacheItem = {
  slot: Slot;
  root: RootHex;
  /** Total number of reads */
  reads: number;
  /** Unix timestamp (ms) of the last read */
  lastRead: number;
  checkpointState: boolean;
};

export type LodestarNodePeer = NodePeer & {
  agentVersion: string;
};

export type LodestarThreadType = "main" | "network" | "discv5";

export type Endpoints = {
  /** Trigger to write a heapdump to disk at `dirpath`. May take > 1min */
  writeHeapdump: Endpoint<
    "POST",
    {thread?: LodestarThreadType; dirpath?: string},
    {query: {thread?: LodestarThreadType; dirpath?: string}},
    {filepath: string},
    EmptyMeta
  >;
  /** Trigger to write 10m network thread profile to disk */
  writeProfile: Endpoint<
    "POST",
    {
      thread?: LodestarThreadType;
      duration?: number;
      dirpath?: string;
    },
    {query: {thread?: LodestarThreadType; duration?: number; dirpath?: string}},
    {filepath: string},
    EmptyMeta
  >;
  /** TODO: description */
  getLatestWeakSubjectivityCheckpointEpoch: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    Epoch,
    EmptyMeta
  >;
  /** TODO: description */
  getSyncChainsDebugState: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    SyncChainDebugState[],
    EmptyMeta
  >;
  /** Dump all items in a gossip queue, by gossipType */
  getGossipQueueItems: Endpoint<
    // ⏎
    "GET",
    {gossipType: string},
    {params: {gossipType: string}},
    unknown[],
    EmptyMeta
  >;
  /** Dump all items in the regen queue */
  getRegenQueueItems: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    RegenQueueItem[],
    EmptyMeta
  >;
  /** Dump all items in the block processor queue */
  getBlockProcessorQueueItems: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    BlockProcessorQueueItem[],
    EmptyMeta
  >;
  /** Dump a summary of the states in the block state cache and checkpoint state cache */
  getStateCacheItems: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    StateCacheItem[],
    EmptyMeta
  >;
  /** Dump peer gossip stats by peer */
  getGossipPeerScoreStats: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    GossipPeerScoreStat[],
    EmptyMeta
  >;
  /** Dump lodestar score stats by peer */
  getLodestarPeerScoreStats: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    PeerScoreStat[],
    EmptyMeta
  >;
  /** Run GC with `global.gc()` */
  runGC: Endpoint<
    // ⏎
    "POST",
    EmptyArgs,
    EmptyRequest,
    EmptyResponseData,
    EmptyMeta
  >;
  /** Drop all states in the state cache */
  dropStateCache: Endpoint<
    // ⏎
    "POST",
    EmptyArgs,
    EmptyRequest,
    EmptyResponseData,
    EmptyMeta
  >;

  /** Connect to peer at this multiaddress */
  connectPeer: Endpoint<
    // ⏎
    "POST",
    {peerId: string; multiaddrs: string[]},
    {query: {peerId: string; multiaddr: string[]}},
    EmptyResponseData,
    EmptyMeta
  >;
  /** Disconnect peer */
  disconnectPeer: Endpoint<
    // ⏎
    "POST",
    {peerId: string},
    {query: {peerId: string}},
    EmptyResponseData,
    EmptyMeta
  >;
  /** Same to node api with new fields */
  getPeers: Endpoint<
    "GET",
    FilterGetPeers,
    {query: {state?: PeerState[]; direction?: PeerDirection[]}},
    LodestarNodePeer[],
    {count: number}
  >;

  /** Dump Discv5 Kad values */
  discv5GetKadValues: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    string[],
    EmptyMeta
  >;

  /**
   * Dump level-db entry keys for a given Bucket declared in code, or for all buckets.
   */
  dumpDbBucketKeys: Endpoint<
    "GET",
    {
      /** Must be the string name of a bucket entry: `allForks_blockArchive` */
      bucket: string;
    },
    {params: {bucket: string}},
    string[],
    EmptyMeta
  >;

  /** Return all entries in the StateArchive index with bucket index_stateArchiveRootIndex */
  dumpDbStateIndex: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    {root: RootHex; slot: Slot}[],
    EmptyMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    writeHeapdump: {
      url: "/eth/v1/lodestar/write_heapdump",
      method: "POST",
      req: {
        writeReq: ({thread, dirpath}) => ({query: {thread, dirpath}}),
        parseReq: ({query}) => ({thread: query.thread, dirpath: query.dirpath}),
        schema: {query: {thread: Schema.String, dirpath: Schema.String}},
      },
      resp: JsonOnlyResponseCodec,
    },
    writeProfile: {
      url: "/eth/v1/lodestar/write_profile",
      method: "POST",
      req: {
        writeReq: ({thread, duration, dirpath}) => ({query: {thread, duration, dirpath}}),
        parseReq: ({query}) => ({thread: query.thread, duration: query.duration, dirpath: query.dirpath}),
        schema: {query: {thread: Schema.String, duration: Schema.Uint, dirpath: Schema.String}},
      },
      resp: JsonOnlyResponseCodec,
    },
    getLatestWeakSubjectivityCheckpointEpoch: {
      url: "/eth/v1/lodestar/ws_epoch",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getSyncChainsDebugState: {
      url: "/eth/v1/lodestar/sync_chains_debug_state",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getGossipQueueItems: {
      url: "/eth/v1/lodestar/gossip_queue_items/:gossipType",
      method: "GET",
      req: {
        writeReq: ({gossipType}) => ({params: {gossipType}}),
        parseReq: ({params}) => ({gossipType: params.gossipType}),
        schema: {params: {gossipType: Schema.StringRequired}},
      },
      resp: JsonOnlyResponseCodec,
    },
    getRegenQueueItems: {
      url: "/eth/v1/lodestar/regen_queue_items",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getBlockProcessorQueueItems: {
      url: "/eth/v1/lodestar/block_processor_queue_items",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getStateCacheItems: {
      url: "/eth/v1/lodestar/state_cache_items",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getGossipPeerScoreStats: {
      url: "/eth/v1/lodestar/gossip_peer_score_stats",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    getLodestarPeerScoreStats: {
      url: "/eth/v1/lodestar/lodestar_peer_score_stats",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    runGC: {
      url: "/eth/v1/lodestar/gc",
      method: "POST",
      req: EmptyRequestCodec,
      resp: EmptyResponseCodec,
    },
    dropStateCache: {
      url: "/eth/v1/lodestar/drop_state_cache",
      method: "POST",
      req: EmptyRequestCodec,
      resp: EmptyResponseCodec,
    },
    connectPeer: {
      url: "/eth/v1/lodestar/connect_peer",
      method: "POST",
      req: {
        writeReq: ({peerId, multiaddrs}) => ({query: {peerId, multiaddr: multiaddrs}}),
        parseReq: ({query}) => ({peerId: query.peerId, multiaddrs: query.multiaddr}),
        schema: {query: {peerId: Schema.StringRequired, multiaddr: Schema.StringArray}},
      },
      resp: EmptyResponseCodec,
    },
    disconnectPeer: {
      url: "/eth/v1/lodestar/disconnect_peer",
      method: "POST",
      req: {
        writeReq: ({peerId}) => ({query: {peerId}}),
        parseReq: ({query}) => ({peerId: query.peerId}),
        schema: {query: {peerId: Schema.StringRequired}},
      },
      resp: EmptyResponseCodec,
    },
    getPeers: {
      url: "/eth/v1/lodestar/peers",
      method: "GET",
      req: {
        writeReq: ({state, direction}) => ({query: {state, direction}}),
        parseReq: ({query}) => ({state: query.state, direction: query.direction}),
        schema: {query: {state: Schema.StringArray, direction: Schema.StringArray}},
      },
      resp: JsonOnlyResponseCodec,
    },
    discv5GetKadValues: {
      url: "/eth/v1/debug/discv5_kad_values",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    dumpDbBucketKeys: {
      url: "/eth/v1/debug/dump_db_bucket_keys/:bucket",
      method: "GET",
      req: {
        writeReq: ({bucket}) => ({params: {bucket}}),
        parseReq: ({params}) => ({bucket: params.bucket}),
        schema: {params: {bucket: Schema.String}},
      },
      resp: JsonOnlyResponseCodec,
    },
    dumpDbStateIndex: {
      url: "/eth/v1/debug/dump_db_state_index",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
  };
}
