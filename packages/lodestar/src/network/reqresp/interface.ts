import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ReqEventEmitter, RespEventEmitter} from "..";
import {IPeerMetadataStore, IRpcScoreTracker} from "../peers";

export interface IReqEventEmitterClass {
  new (): ReqEventEmitter;
}

export interface IRespEventEmitterClass {
  new (): RespEventEmitter;
}

export interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  peerMetadata: IPeerMetadataStore;
  blockProviderScores: IRpcScoreTracker;
}
