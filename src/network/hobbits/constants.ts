export type RequestId = number;

export enum Method {
  Hello = 0,
  Goodbye = 1,
  GetStatus = 2,
  GetBlockHeaders = 10,
  BlockHeaders = 11,
  GetBlockBodies = 12,
  BlockBodies = 13,
}

export enum ResponseCode {
  Success = 0,
  ParseError = 10,
  InvalidRequest = 20,
  MethodNotFound = 30,
  ServerError = 40,
}

export const HOBBITS_VERSION = 2;

export enum ProtocolType {
  RPC = 0,
  GOSSIP = 1,
  PING = 2
}
