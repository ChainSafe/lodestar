// gossip

export const ATTESTATION_SUBNET_COUNT = 64;
export const ATTESTATION_PROPAGATION_SLOT_RANGE = 23;

// req/resp

export type RequestId = string;

export enum Method {
  Status = "status",
  Goodbye = "goodbye",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
}

export enum Encoding {
  ssz = "ssz",
}

export const ERR_INVALID_REQ = "invalid request";
export const ERR_RESP_TIMEOUT = "response timeout";
export const GOSSIP_MAX_SIZE = 2**20;
export const MAX_CHUNK_SIZE = 2**20;
export const TTFB_TIMEOUT = 5 * 1000; // 10 sec
export const RESP_TIMEOUT = 10 * 1000; // 10 sec

