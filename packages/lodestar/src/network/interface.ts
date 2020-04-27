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
  Metadata,
  Ping,
} from "@chainsafe/lodestar-types";
import {Method, RequestId} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";
import {IGossip} from "./gossip/interface";
import {RpcError} from "./error";
import {MetadataController} from "./metadata";


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
  sendResponseStream(id: RequestId, err: RpcError, chunkIter: AsyncIterable<ResponseBody>): void;

  status(peerInfo: PeerInfo, request: Status): Promise<Status>;
  goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void>;
  ping(peerInfo: PeerInfo, request: Ping): Promise<Ping>;
  metadata(peerInfo: PeerInfo): Promise<Metadata>;
  beaconBlocksByRange(peerInfo: PeerInfo, request: BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]>;
  beaconBlocksByRoot(peerInfo: PeerInfo, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]>;
}

// network

export interface INetworkEvents {
  ["peer:connect"]: (peerInfo: PeerInfo, direction: "inbound"|"outbound") => void;
  ["peer:disconnect"]: (peerInfo: PeerInfo) => void;
}
export type NetworkEventEmitter = StrictEventEmitter<EventEmitter, INetworkEvents>;

export interface INetwork extends NetworkEventEmitter {
  reqResp: IReqResp;
  gossip: IGossip;
  metadata: MetadataController;
  /**
   * Our network identity
   */
  peerInfo: PeerInfo;
  getPeers(): PeerInfo[];
  hasPeer(peerInfo: PeerInfo): boolean;
  connect(peerInfo: PeerInfo): Promise<void>;
  disconnect(peerInfo: PeerInfo): Promise<void>;
  searchSubnetPeers(subnet: string): Promise<void>;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
}
