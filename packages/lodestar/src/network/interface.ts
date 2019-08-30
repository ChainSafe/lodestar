/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";
import {
  Attestation, BeaconBlock, Shard, ResponseBody, RequestBody,
} from "@chainsafe/eth2.0-types";

import {RequestId, Method, BLOCK_TOPIC, ATTESTATION_TOPIC} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";

export type NetworkEventEmitter = StrictEventEmitter<EventEmitter, INetworkEvents>;

export interface INetworkEvents {
  [BLOCK_TOPIC]: (block: BeaconBlock) => void;
  [ATTESTATION_TOPIC]: (attestation: Attestation) => void;
  ["gossipsub:heartbeat"]: void;
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
  ["peer:connect"]: (peerInfo: PeerInfo) => void;
  ["peer:disconnect"]: (peerInfo: PeerInfo) => void;
  // shard attestation topic is generated string so we cannot typehint it
  //[shard{shardNumber % SHARD_SUBNET_COUNT}_beacon_attestation]: (attestation: Attestation) => void;
}

export interface INetwork extends NetworkEventEmitter {
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
  // rpc
  sendRequest(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<ResponseBody>;
  sendResponse(id: RequestId, err: Error, result: ResponseBody): void;
  // peer
  getPeers(): PeerInfo[];
  hasPeer(peerInfo: PeerInfo): boolean;
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peerInfo: PeerInfo): void;
}
