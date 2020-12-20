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

export interface IResponseChunk {
  requestId: RequestId;
  status: RpcResponseStatus;
  body: ResponseBody;
}

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
