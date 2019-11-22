/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRangeResponse,
  BeaconBlocksByRootRequest,
  BeaconBlocksByRootResponse,
  Goodbye,
  RequestBody,
  ResponseBody, Status,
} from "@chainsafe/eth2.0-types";

import {Method, RequestId} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";
import {IGossip} from "./gossip/interface";

// req/resp

export interface IReqRespEvents {
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
}
export type ReqRespEventEmitter = StrictEventEmitter<EventEmitter, IReqRespEvents>;

export interface IReqResp extends ReqRespEventEmitter {
  // sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T>;
  sendResponse(id: RequestId, err: Error|null, result: ResponseBody|null): void;

  status(peerInfo: PeerInfo, request: Status): Promise<Status>;
  goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void>;
  beaconBlocksByRange(peerInfo: PeerInfo, request: BeaconBlocksByRangeRequest): Promise<BeaconBlocksByRangeResponse>;
  beaconBlocksByRoot(peerInfo: PeerInfo, request: BeaconBlocksByRootRequest): Promise<BeaconBlocksByRootResponse>;
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
