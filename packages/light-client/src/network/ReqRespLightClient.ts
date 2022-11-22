import {PeerId} from "@libp2p/interface-peer-id";
import {collectExactOne, collectMaxResponse, Encoding, ReqResp} from "@lodestar/reqresp";
import {allForks, altair, phase0, Root} from "@lodestar/types";
import {PeersData} from "@lodestar/reqresp/peers/peersData";
import {ReqRespMethod} from "./types.js";

// TODO DA de-duplicate
export enum Version {
  V1 = 1,
  V2 = 2,
}

export class ReqRespLightClient extends ReqResp {
  private readonly peersData: PeersData | undefined;
  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<altair.LightClientBootstrap> {
    return collectExactOne(
      this.sendRequest<Root, altair.LightClientBootstrap>(
        peerId,
        ReqRespMethod.LightClientBootstrap,
        [Version.V1],
        request
      )
    );
  }

  async beaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectMaxResponse(
      this.sendRequest<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>(
        peerId,
        ReqRespMethod.BeaconBlocksByRoot,
        [Version.V2, Version.V1], // Prioritize V2
        request
      ),
      request.length
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<altair.LightClientOptimisticUpdate> {
    return collectExactOne(
      this.sendRequest<null, altair.LightClientOptimisticUpdate>(
        peerId,
        ReqRespMethod.LightClientOptimisticUpdate,
        [Version.V1],
        null
      )
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<altair.LightClientFinalityUpdate> {
    return collectExactOne(
      this.sendRequest<null, altair.LightClientFinalityUpdate>(
        peerId,
        ReqRespMethod.LightClientFinalityUpdate,
        [Version.V1],
        null
      )
    );
  }

  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<altair.LightClientUpdate[]> {
    return collectMaxResponse(
      this.sendRequest<altair.LightClientUpdatesByRange, altair.LightClientUpdate>(
        peerId,
        ReqRespMethod.LightClientUpdatesByRange,
        [Version.V1],
        request
      ),
      request.count
    );
  }

  protected sendRequest<Req, Resp>(peerId: PeerId, method: string, versions: number[], body: Req): AsyncIterable<Resp> {
    // Remember prefered encoding
    const encoding = this.peersData?.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;

    return super.sendRequest(peerId, method, versions, encoding, body);
  }
}
