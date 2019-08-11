/**
 * @module network/hobbits
 */


export type RequestId = number;

export enum ProtocolType {
  RPC = 0,
  GOSSIP = 1,
  PING = 2
}

export const HOBBITS_VERSION = 3;

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
  GetBeaconStates = 16,
  BeaconStates = 17
}

/*
export enum Method {
  Hello = 0, Hello : HobbitsHello
  Goodbye = 1, Goodbye
  GetStatus = 2, Status : HobbitsStatus
  GetBlockHeaders = 10, // request : BeaconBlockHeadersRequest : HobbitsGetBlockHeaders
  BlockHeaders = 11,  // response : BeaconBlockHeadersResponse
  GetBlockBodies = 12,  // request : HobbitsGetBlockBodies : HobbitsGetBlockBodies
  BlockBodies = 13, // response : BeaconBlockBodiesResponse : HobbitsBlockBodies
  GetAttestation = 14, // request : HobbitsGetAttestation : HobbitsGetAttestation
  AttestationResponse = 15,  // response : HobbitsAttestation : HobbitsAttestation
  GetBeaconStates = 16,  // request : BeaconStatesRequest : BeaconStatesRequest
  BeaconStates = 17  // response :  BeaconStatesResponse : BeaconStatesResponse
}
*/
