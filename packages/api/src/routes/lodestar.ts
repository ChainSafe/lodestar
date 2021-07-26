import {Epoch, Slot, ssz} from "@chainsafe/lodestar-types";
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
  StringType,
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
  blocks: Slot[];
  jobOpts: Json;
  addedTimeMs: number;
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
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getWtfNode: {url: "/eth/v1/lodestar/wtfnode/", method: "GET"},
  writeHeapdump: {url: "/eth/v1/lodestar/writeheapdump/", method: "GET"},
  getLatestWeakSubjectivityCheckpointEpoch: {url: "/eth/v1/lodestar/ws_epoch/", method: "GET"},
  getSyncChainsDebugState: {url: "/eth/v1/lodestar/sync-chains-debug-state/", method: "GET"},
  getGossipQueueItems: {url: "/eth/v1/lodestar/gossip-queue-items/:gossipType", method: "GET"},
  getRegenQueueItems: {url: "/eth/v1/lodestar/regen-queue-items/", method: "GET"},
  getBlockProcessorQueueItems: {url: "/eth/v1/lodestar/block-processor-queue-items/", method: "GET"},
};

export type ReqTypes = {
  getWtfNode: ReqEmpty;
  writeHeapdump: {query: {dirpath?: string}};
  getLatestWeakSubjectivityCheckpointEpoch: ReqEmpty;
  getSyncChainsDebugState: ReqEmpty;
  getGossipQueueItems: {params: {gossipType: string}};
  getRegenQueueItems: ReqEmpty;
  getBlockProcessorQueueItems: ReqEmpty;
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
  });

  return {
    getWtfNode: sameType(),
    writeHeapdump: sameType(),
    getLatestWeakSubjectivityCheckpointEpoch: sameType(),
    getSyncChainsDebugState: jsonType(),
    getGossipQueueItems: ArrayOf(GossipQueueItem),
    getRegenQueueItems: jsonType(),
    getBlockProcessorQueueItems: jsonType(),
  };
}
