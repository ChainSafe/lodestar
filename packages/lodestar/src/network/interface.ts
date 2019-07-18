/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";

import {
  Attestation, BeaconBlock, Shard, ResponseBody, RequestBody,
} from "../types";
import {RequestId, Method} from "../constants";

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
