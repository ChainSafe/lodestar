import {PeerId} from "@libp2p/interface-peer-id";
import {ReqResp, ReqRespModules, ReqRespOptions, RequestTypedContainer} from "@lodestar/reqresp";
import {RateLimiterOptions} from "@lodestar/reqresp/rate_limiter";
import {INetworkEventBus, NetworkEvent} from "../events.js";

export interface BeaconNodeReqRespModules extends ReqRespModules {
  networkEventBus: INetworkEventBus;
}

export class BeaconNodeReqResp extends ReqResp {
  private networkEventBus: INetworkEventBus;

  constructor(modules: BeaconNodeReqRespModules, options?: Partial<ReqRespOptions> & Partial<RateLimiterOptions>) {
    super(modules, options);
    this.networkEventBus = modules.networkEventBus;
  }

  protected onIncomingRequestBody(req: RequestTypedContainer, peerId: PeerId): void {
    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, req, peerId), 0);
  }
}
