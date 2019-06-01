/**
 * @module network
 */
import {BeaconBlock, Attestation, Shard, Hello, Goodbye, Status, BeaconBlockRootsRequest, BeaconBlockRootsResponse, BeaconBlockHeadersRequest, BeaconBlockHeadersResponse, BeaconBlockBodiesRequest, BeaconBlockBodiesResponse, BeaconStatesRequest, BeaconStatesResponse} from "../types";

import PeerInfo from "peer-info";

export interface NetworkOptions {
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
}

export interface IPeer {
  peerInfo: PeerInfo;
  hello(request: Hello): Promise<Hello>;
  goodbye(request: Goodbye): Promise<void>;
  getStatus(request: Status): Promise<Status>;
  getBeaconBlockRoots(request: BeaconBlockRootsRequest): Promise<BeaconBlockRootsResponse>;
  getBeaconBlockHeaders(request: BeaconBlockHeadersRequest): Promise<BeaconBlockHeadersResponse>;
  getBeaconBlockBodies(request: BeaconBlockBodiesRequest): Promise<BeaconBlockBodiesResponse>;
  getBeaconStates(request: BeaconStatesRequest): Promise<BeaconStatesResponse>;
}

export interface INetwork {
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
  // Pubsub
  publishBlock(block: BeaconBlock): Promise<void>;
  publishAttestation(attestation: Attestation): Promise<void>;
  publishShardAttestation(shard: Shard, attestation: Attestation): Promise<void>;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  // Rpc/peer
  getPeers(): IPeer[];
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peer: IPeer): void;
}
