/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";
import {
  Attestation, BeaconBlock, Shard,
  RequestBody, ResponseBody,
  Hello, Goodbye,
  BeaconBlocksRequest, BeaconBlocksResponse,
  RecentBeaconBlocksRequest, RecentBeaconBlocksResponse,
} from "@chainsafe/eth2.0-types";

import {RequestId, Method, BLOCK_TOPIC, ATTESTATION_TOPIC} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";

// req/resp

export interface IReqRespEvents {
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
}
export type ReqRespEventEmitter = StrictEventEmitter<EventEmitter, IReqRespEvents>;

export interface IReqResp extends ReqRespEventEmitter {
  // sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T>;
  sendResponse(id: RequestId, err: Error, result: ResponseBody): void;

  hello(peerInfo: PeerInfo, request: Hello): Promise<Hello>;
  goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void>;
  beaconBlocks(peerInfo: PeerInfo, request: BeaconBlocksRequest): Promise<BeaconBlocksResponse>;
  recentBeaconBlocks(peerInfo: PeerInfo, request: RecentBeaconBlocksRequest): Promise<RecentBeaconBlocksResponse>;
}

// gossip

export interface IGossipEvents {
  [BLOCK_TOPIC]: (block: BeaconBlock) => void;
  [ATTESTATION_TOPIC]: (attestation: Attestation) => void;
  ["gossipsub:heartbeat"]: void;
  // shard attestation topic is generated string so we cannot typehint it
  //[shard{shardNumber % SHARD_SUBNET_COUNT}_beacon_attestation]: (attestation: Attestation) => void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;


export interface IGossip extends GossipEventEmitter {
  publishBlock(block: BeaconBlock): Promise<void>;
  publishAttestation(attestation: Attestation): Promise<void>;
  publishShardAttestation(attestation: Attestation): Promise<void>;
  subscribeToBlocks(): void;
  subscribeToAttestations(): void;
  subscribeToShardAttestations(shard: Shard): void;
  unsubscribeToBlocks(): void;
  unsubscribeToAttestations(): void;
  unsubscribeToShardAttestations(shard: Shard): void;
}

// network

export interface INetworkEvents {
  ["peer:connect"]: (peerInfo: PeerInfo) => void;
  ["peer:disconnect"]: (peerInfo: PeerInfo) => void;
}
export type NetworkEventEmitter = StrictEventEmitter<EventEmitter, INetworkEvents>;

export interface INetwork extends NetworkEventEmitter {
  reqResp: IReqResp;
  gossip: IGossip;
  /**
   * Our network identity
   */
  peerInfo: PeerInfo;
  getPeers(): PeerInfo[];
  hasPeer(peerInfo: PeerInfo): boolean;
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peerInfo: PeerInfo): void;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
}
