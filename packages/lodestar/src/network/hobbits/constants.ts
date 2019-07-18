/**
 * @module network/hobbits
 */


export type RequestId = number;

export enum Method {
  Hello = 0,
  Goodbye = 1,
  GetStatus = 2,
  GetBlockHeaders = 10,
  BlockHeaders = 11,
  GetBlockBodies = 12,
  BlockBodies = 13,
  GetAttestation = 14,
  AttestationResponse = 15,
}

export enum ProtocolType {
  RPC = 0,
  GOSSIP = 1,
  PING = 2
}

export const HOBBITS_VERSION = 3;
