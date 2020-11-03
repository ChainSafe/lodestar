import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RequestId, RequestBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ReqEventEmitter} from "..";
import {Method, ReqRespEncoding} from "../../constants";
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
