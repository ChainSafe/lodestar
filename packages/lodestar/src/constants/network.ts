// gossip

import {IBeaconConfig} from "@chainsafe/lodestar-config";

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

export enum MethodRequestType {
  "status" = "Status",
  "goodbye" = "Goodbye",
  "ping" = "Ping",
  "metadata" = "Metadata",
  "beacon_blocks_by_range" = "BeaconBlocksByRangeRequest",
  "beacon_blocks_by_root" = "BeaconBlocksByRootRequest",
}

export enum MethodResponseType {
  SingleResponse = "SingleResponse",
  NoResponse = "NoResponse",
  Stream = "Stream",
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Methods = {
  [Method.Status]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.Status => config.types.Status,
    responseSSZType: (config: IBeaconConfig): typeof config.types.Status => config.types.Status,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Goodbye]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.Goodbye => config.types.Goodbye,
    responseSSZType: (config: IBeaconConfig): typeof config.types.Goodbye => config.types.Goodbye,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Ping]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.Ping => config.types.Ping,
    responseSSZType: (config: IBeaconConfig): typeof config.types.Ping => config.types.Ping,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Metadata]: {
    requestSSZType: (): null => null,
    responseSSZType: (config: IBeaconConfig): typeof config.types.Metadata => config.types.Metadata,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.BeaconBlocksByRange]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.BeaconBlocksByRangeRequest =>
      config.types.BeaconBlocksByRangeRequest,
    responseSSZType: (config: IBeaconConfig): typeof config.types.SignedBeaconBlock => config.types.SignedBeaconBlock,
    responseType: MethodResponseType.Stream,
  },
  [Method.BeaconBlocksByRoot]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.BeaconBlocksByRootRequest =>
      config.types.BeaconBlocksByRootRequest,
    responseSSZType: (config: IBeaconConfig): typeof config.types.SignedBeaconBlock => config.types.SignedBeaconBlock,
    responseType: MethodResponseType.Stream,
  },
};

export enum ReqRespEncoding {
  SSZ = "ssz",
  SSZ_SNAPPY = "ssz_snappy",
}

export enum RpcResponseStatus {
  SUCCESS = 0,
  INVALID_REQ = 1,
  SERVER_ERROR = 2,
}

export const GOSSIP_MAX_SIZE = 2 ** 20;
export const MAX_CHUNK_SIZE = 2 ** 20;
export const TTFB_TIMEOUT = 5 * 1000; // 5 sec
export const RESP_TIMEOUT = 10 * 1000; // 10 sec
export const REQUEST_TIMEOUT = 5 * 1000; // 5 sec
