/**
 * @module network
 */
import PeerInfo from "peer-info";
import {EventEmitter} from "events";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {Method, RequestId} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";
import {IGossip} from "./gossip/interface";
import {RpcError} from "./error";


export type ResponseCallbackFn = ((responseIter: AsyncIterable<ResponseChunk>) => void);

export type ResponseChunk = {err?: RpcError; output?: ResponseBody};

interface IRespEvents {
  [responseEvent: string]: ResponseCallbackFn;
}

export interface IReqEvents {
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
}

export type ReqEventEmitter = StrictEventEmitter<EventEmitter, IReqEvents>;
export type RespEventEmitter = StrictEventEmitter<EventEmitter, IRespEvents>;

export interface IReqResp extends ReqEventEmitter {
  // sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T>;
  sendResponse(id: RequestId, err: Error|null, result: ResponseBody[]): void;
  sendResponseStream(id: RequestId, err: Error, chunkIter: AsyncIterable<ResponseBody>): void;

  status(peerInfo: PeerInfo, request: Status): Promise<Status>;
  goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void>;
  beaconBlocksByRange(peerInfo: PeerInfo, request: BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]>;
  beaconBlocksByRoot(peerInfo: PeerInfo, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]>;
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
