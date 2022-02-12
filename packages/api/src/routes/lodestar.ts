import {Epoch, RootHex, Slot, ssz, StringType} from "@chainsafe/lodestar-types";
import {ByteVectorType, ContainerType, Json} from "@chainsafe/ssz";
import {
  jsonType,
  ReqEmpty,
  reqEmpty,
  ReturnTypes,
  ReqSerializers,
  RoutesData,
  sameType,
  Schema,
  ArrayOf,
} from "../utils";

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
  receivedFrom: string;
  data: Uint8Array;
  addedTimeMs: number;
};

export type RegenQueueItem = {
  key: string;
  args: Json;
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
  /** Run GC with `global.gc()` */
  runGC(): Promise<void>;
  /** Drop all states in the state cache */
  dropStateCache(): Promise<void>;

  /** Connect to peer at this multiaddress */
  connectPeer(peerId: string, multiaddrStrs: string[]): Promise<void>;
  /** Disconnect peer */
  disconnectPeer(peerId: string): Promise<void>;

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
  runGC: {url: "/eth/v1/lodestar/gc", method: "POST"},
  dropStateCache: {url: "/eth/v1/lodestar/drop-state-cache", method: "POST"},
  connectPeer: {url: "/eth/v1/lodestar/connect_peer", method: "POST"},
  disconnectPeer: {url: "/eth/v1/lodestar/disconnect_peer", method: "POST"},
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
  runGC: ReqEmpty;
  dropStateCache: ReqEmpty;
  connectPeer: {query: {peerId: string; multiaddr: string[]}};
  disconnectPeer: {query: {peerId: string}};
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
    discv5GetKadValues: reqEmpty,
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export function getReturnTypes(): ReturnTypes<Api> {
  const stringType = new StringType();
  const GossipQueueItem = new ContainerType<GossipQueueItem>({
    fields: {
      topic: stringType,
      receivedFrom: stringType,
      data: new ByteVectorType({length: 256}),
      addedTimeMs: ssz.Slot,
    },
    // Custom type, not in the consensus specs
    casingMap: {
      topic: "topic",
      receivedFrom: "received_from",
      data: "data",
      addedTimeMs: "added_time_ms",
    },
  });

  return {
    getWtfNode: sameType(),
    writeHeapdump: sameType(),
    getLatestWeakSubjectivityCheckpointEpoch: sameType(),
    getSyncChainsDebugState: jsonType(),
    getGossipQueueItems: ArrayOf(GossipQueueItem),
    getRegenQueueItems: jsonType(),
    getBlockProcessorQueueItems: jsonType(),
    getStateCacheItems: jsonType(),
    getCheckpointStateCacheItems: jsonType(),
    discv5GetKadValues: jsonType(),
  };
}
