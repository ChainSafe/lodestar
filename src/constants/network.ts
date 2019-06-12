export type RequestId = string;

export enum Method {
  Hello = 0,
  Goodbye = 1,
  Status = 2,
  BeaconBlockRoots = 10,
  BeaconBlockHeaders = 11,
  BeaconBlockBodies = 12,
  BeaconStates = 13,
}

export enum ResponseCode {
  Success = 0,
  ParseError = 10,
  InvalidRequest = 20,
  MethodNotFound = 30,
  ServerError = 40,
}

export const BLOCK_TOPIC = "beacon_block";
export const ATTESTATION_TOPIC = "beacon_attestation";
export const SHARD_SUBNET_COUNT = 10;
export const RPC_MULTICODEC = "/eth/serenity/beacon/rpc/1";
