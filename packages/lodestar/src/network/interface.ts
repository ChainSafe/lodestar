/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";

import {
  Attestation, BeaconBlock, Shard, ResponseBody, RequestBody,
} from "@chainsafe/eth2-types";
import {RequestId, Method} from "../../../eth2-types/src/constants";

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
  getPeers(): PeerInfo[];
  hasPeer(peerInfo: PeerInfo): boolean;
  sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T>;
  sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void;
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peerInfo: PeerInfo): void;
}
