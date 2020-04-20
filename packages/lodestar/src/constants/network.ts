// gossip

export const ATTESTATION_SUBNET_COUNT = 64;
export const ATTESTATION_PROPAGATION_SLOT_RANGE = 23;
export const MAXIMUM_GOSSIP_CLOCK_DISPARITY = 500;
// req/resp

export type RequestId = string;

export enum Method {
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
}

// Methods that returns 1 single response_chunk
export const SINGLE_CHUNK_METHODS = [Method.Status, Method.Ping, Method.Metadata];
// Request only method
export const NO_CHUNK_METHODS = [Method.Goodbye];

export enum ReqRespEncoding {
  SSZ = "ssz",
  SSZ_SNAPPY = "ssz_snappy",
}

export enum RpcErrorCode {
  ERR_INVALID_REQ = 1,
  ERR_RESP_TIMEOUT = 2,
}

export const GOSSIP_MAX_SIZE = 2**20;
export const MAX_CHUNK_SIZE = 2**20;
export const TTFB_TIMEOUT = 5 * 1000; // 5 sec
export const RESP_TIMEOUT = 10 * 1000; // 10 sec

