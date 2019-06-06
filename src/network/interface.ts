/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";

import {BeaconBlock, Attestation, Shard, Hello, Goodbye, Status, BeaconBlockRootsRequest, BeaconBlockRootsResponse, BeaconBlockHeadersRequest, BeaconBlockHeadersResponse, BeaconBlockBodiesRequest, BeaconBlockBodiesResponse, BeaconStatesRequest, BeaconStatesResponse, ResponseBody, RequestBody} from "../types";
import {RequestId, Method} from "./codec";

export interface INetworkOptions {
  maxPeers: number;
  /**
   * Multiaddrs to listen on
   */
  multiaddrs: string[];
  bootnodes: string[];
  /**
   * RPC request timeout in milliseconds
   */
  rpcTimeout: number;

  connectTimeout: number;
  disconnectTimeout: number;
}

export interface IPeer {
  peerInfo: PeerInfo;
  latestHello: Hello | null;
  latestStatus: Status | null;
  hello(request: Hello): Promise<Hello>;
  goodbye(request: Goodbye): Promise<void>;
  getStatus(request: Status): Promise<Status>;
  getBeaconBlockRoots(request: BeaconBlockRootsRequest): Promise<BeaconBlockRootsResponse>;
  getBeaconBlockHeaders(request: BeaconBlockHeadersRequest): Promise<BeaconBlockHeadersResponse>;
  getBeaconBlockBodies(request: BeaconBlockBodiesRequest): Promise<BeaconBlockBodiesResponse>;
  getBeaconStates(request: BeaconStatesRequest): Promise<BeaconStatesResponse>;
}

export interface INetwork extends EventEmitter {
  peerInfo: PeerInfo;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
  // Pubsub
  publishBlock(block: BeaconBlock): Promise<void>;
  publishAttestation(attestation: Attestation): Promise<void>;
  publishShardAttestation(attestation: Attestation): Promise<void>;
  subscribeToBlocks(): void;
  subscribeToAttestations(): void;
  subscribeToShardAttestations(shard: Shard): void;
  unsubscribeToBlocks(): void;
  unsubscribeToAttestations(): void;
  unsubscribeToShardAttestations(shard: Shard): void;
  // Rpc/peer
  getPeers(): IPeer[];
  getPeer(peerInfo: PeerInfo): IPeer | null;
  sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void;
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peer: IPeer): void;
}
