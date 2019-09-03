// gossip

export const BLOCK_TOPIC = "beacon_block";
export const ATTESTATION_TOPIC = "beacon_attestation";
export const SHARD_ATTESTATION_TOPIC = "shard{shard}_attestation";
export const SHARD_SUBNET_COUNT = 10;

// req/resp

export type RequestId = string;

export enum Method {
  Hello = "hello",
  Goodbye = "goodbye",
  BeaconBlocks = "beacon_blocks",
  RecentBeaconBlocks = "recent_beacon_blocks",
}

export enum Encoding {
  ssz = "ssz",
}

export const ERR_INVALID_REQ = "invalid request";
export const ERR_RESP_TIMEOUT = "response timeout";
export const REQ_RESP_MAX_SIZE = 2 ** 22; // ~4MB
export const TTFB_TIMEOUT = 5 * 1000; // 10 sec
export const RESP_TIMEOUT = 10 * 1000; // 10 sec

