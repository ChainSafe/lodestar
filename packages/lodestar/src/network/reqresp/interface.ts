import PeerId from "peer-id";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RequestId, RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ReqEventEmitter} from "..";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {IPeerMetadataStore, IRpcScoreTracker} from "../peers";

export interface IReqEventEmitterClass {
  new (): ReqEventEmitter;
}

export interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  peerMetadata: IPeerMetadataStore;
  blockProviderScores: IRpcScoreTracker;
}

export type ReqRespRequest<Body extends RequestBody | null = null> = {
  method: Method;
  id: RequestId;
  body: Body;
  encoding: ReqRespEncoding;
};

export type IResponseChunk =
  | {status: RpcResponseStatus.SUCCESS; body: ResponseBody}
  | {status: RpcResponseStatus.INVALID_REQUEST | RpcResponseStatus.SERVER_ERROR; errorMessage: string};

export interface IValidatedRequestBody {
  isValid: boolean;
  // missing body if isValid=false
  body?: RequestBody;
}

export type RequestOrResponseType = Exclude<
  ReturnType<typeof Methods[Method]["responseSSZType"]> | ReturnType<typeof Methods[Method]["requestSSZType"]>,
  null
>;

export type RequestOrResponseBody = ResponseBody | RequestBody;

export type ReqRespHandler = (method: Method, requestBody: RequestBody, peerId: PeerId) => AsyncIterable<ResponseBody>;

/**
 * Stream types from libp2p.dialProtocol are too vage and cause compilation type issues
 * These source and sink types are more precise to our usage
 */
export interface ILibP2pStream {
  source: AsyncIterable<Buffer>;
  sink: (source: AsyncIterable<Buffer>) => Promise<void>;
  close: () => void;
  reset: () => void;
}
