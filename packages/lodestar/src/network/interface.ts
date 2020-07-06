/**
 * @module network
 */
import {EventEmitter} from "events";
import PeerId from "peer-id";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Metadata,
  Ping,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {Method, RequestId} from "../constants";
import StrictEventEmitter from "strict-event-emitter-types";
import {IGossip} from "./gossip/interface";
import {RpcError} from "./error";
import {MetadataController} from "./metadata";
import {IResponseChunk} from "./encoders/interface";
import Multiaddr from "multiaddr";


export type ResponseCallbackFn = ((responseIter: AsyncIterable<IResponseChunk>) => void);

interface IRespEvents {
  [responseEvent: string]: ResponseCallbackFn;
}

export interface IReqEvents {
  request: (peerId: PeerId, method: Method, id: RequestId, body: RequestBody) => void;
}

export type ReqEventEmitter = StrictEventEmitter<EventEmitter, IReqEvents>;
export type RespEventEmitter = StrictEventEmitter<EventEmitter, IRespEvents>;

export interface IReqResp extends ReqEventEmitter {
  sendResponseStream(id: RequestId, err: RpcError, chunkIter: AsyncIterable<ResponseBody>): void;
  sendResponse(id: RequestId, err: RpcError, response?: ResponseBody): void;
  status(peerId: PeerId, request: Status): Promise<Status|null>;
  goodbye(peerId: PeerId, request: Goodbye): Promise<void>;
  ping(peerId: PeerId, request: Ping): Promise<Ping|null>;
  metadata(peerId: PeerId): Promise<Metadata|null>;
  beaconBlocksByRange(peerId: PeerId, request: BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]|null>;
  beaconBlocksByRoot(peerId: PeerId, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]|null>;
}

// network

export interface INetworkEvents {
  ["peer:connect"]: (peerId: PeerId, direction: "inbound"|"outbound") => void;
  ["peer:disconnect"]: (peerId: PeerId) => void;
}
export type NetworkEventEmitter = StrictEventEmitter<EventEmitter, INetworkEvents>;

export interface INetwork extends NetworkEventEmitter {
  reqResp: IReqResp;
  gossip: IGossip;
  metadata: MetadataController;
  /**
   * Our network identity
   */
  peerId: PeerId;
  multiaddrs: Multiaddr[];
  getPeers(): PeerId[];
  hasPeer(peerId: PeerId): boolean;
  connect(peerId: PeerId, multiaddrs?: Multiaddr[]): Promise<void>;
  disconnect(peerId: PeerId): Promise<void>;
  searchSubnetPeers(subnet: string): Promise<void>;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
}
